"""Poll owned input and acknowledge a single dispatch without replaying CLI input."""

import asyncio

from studio.contracts.amadeus.instructions import InstructionClaim, InstructionReceipt


async def deliver_instructions(instructions, claim, settle, flush):
    while True:
        await flush()
        value = await claim(instructions.ready)
        if value is not None:
            item = InstructionClaim.model_validate(value)
            status = "unknown"
            try:
                status = await instructions.submit(item.request_id, item.text)
            finally:
                status = instructions.outcomes.pop(item.request_id, status)
                # Cancellation may have happened after the native write. Persist the
                # unknown receipt; never claim or send the same instruction again.
                closing = asyncio.create_task(
                    settle(
                        InstructionReceipt(
                            request_id=item.request_id,
                            text_sha256=item.text_sha256,
                            status=status,
                        )
                    )
                )
                try:
                    await asyncio.shield(closing)
                except asyncio.CancelledError:
                    await closing
                    raise
        await asyncio.sleep(0.5)
