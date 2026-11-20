"""Poll owned input and acknowledge a single dispatch without replaying CLI input."""

import asyncio

from studio.contracts.amadeus.instructions import InstructionClaim, InstructionReceipt


async def finish_before_cancel(operation):
    """Short owned DB callbacks must settle even after repeated Stop requests."""
    task = asyncio.create_task(operation)
    cancelled = False
    while not task.done():
        try:
            await asyncio.shield(task)
        except asyncio.CancelledError:
            cancelled = True
    if cancelled:
        # Observe any failure without leaving a task holding a writer transaction.
        await asyncio.gather(task, return_exceptions=True)
        raise asyncio.CancelledError
    return task.result()


async def deliver_instructions(instructions, claim, settle, flush):
    while True:
        await finish_before_cancel(flush())
        value = await finish_before_cancel(claim(instructions.ready))
        if value is not None:
            item = InstructionClaim.model_validate(value)
            status = "unknown"
            try:
                status = await instructions.submit(item.request_id, item.text)
            finally:
                status = instructions.outcomes.pop(item.request_id, status)
                # Cancellation may have happened after the native write. Persist the
                # unknown receipt; never claim or send the same instruction again.
                await finish_before_cancel(
                    settle(
                        InstructionReceipt(
                            request_id=item.request_id,
                            text_sha256=item.text_sha256,
                            status=status,
                        )
                    )
                )
        await asyncio.sleep(0.5)
