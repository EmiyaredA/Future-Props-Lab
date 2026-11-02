"""Commit one account's catalogue and receipt before acknowledging its Identity event."""

import time

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.llm.models import ModelCatalogState
from fpl_runtime.catalog_events import CatalogDelivery

from .models import AccountDefaults, CatalogProvisioningReceipt


class CatalogProvisioningConflict(RuntimeError):
    pass


class CatalogProvisioningExpired(RuntimeError):
    pass


class CatalogProvisioning:
    def __init__(self, session_factory, *, initializer):
        self.sessions, self.initializer = session_factory, initializer

    async def apply(self, delivery: CatalogDelivery):
        event = delivery.event
        owner = event.payload.user_id
        try:
            async with self.sessions(info={"owner_user_id": owner}) as session:
                await session.execute(text("BEGIN IMMEDIATE"))
                receipt = await session.get(CatalogProvisioningReceipt, event.id)
                if receipt is not None:
                    if (
                        receipt.event_revision != event.revision
                        or receipt.event_digest != event.digest()
                    ):
                        raise CatalogProvisioningConflict("Identity 事件内容与已有回执不一致")
                    return receipt.outcome
                now = time.time()
                if not now < delivery.expires_at <= now + 25:
                    raise CatalogProvisioningExpired("Identity 目录初始化状态已过期或时钟不匹配")
                state = await session.get(ModelCatalogState, owner)
                outcome = "preserved" if state is not None else "initialized"
                if state is None:
                    await self.initializer(session, owner, delivery.account.platform_role)
                    if await session.get(ModelCatalogState, owner) is None:
                        raise RuntimeError("目录初始化未建立 Models 账号状态")
                if await session.get(AccountDefaults, owner) is None:
                    session.add(AccountDefaults(owner_user_id=owner, model_ids={}, revision=0))
                session.add(
                    CatalogProvisioningReceipt(
                        event_id=event.id,
                        owner_user_id=owner,
                        event_revision=event.revision,
                        event_digest=event.digest(),
                        initialization_role=delivery.account.platform_role,
                        account_revision=delivery.account.revision,
                        outcome=outcome,
                    )
                )
                await session.commit()
                return outcome
        except IntegrityError:
            raise CatalogProvisioningConflict("目录初始化事件或账号与已有回执冲突") from None
