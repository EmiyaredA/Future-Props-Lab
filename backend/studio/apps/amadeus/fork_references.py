"""Recheck references against the current business owner before copying them."""

from studio.contracts.amadeus.message_forks import PROJECT_READS
from studio.runtime.database.operation_receipts import OperationError


def project_reader(call_read):
    async def can_read(resource, project_id):
        operation, parameter = PROJECT_READS[resource]
        try:
            await call_read(f"{resource}.{operation}", {"path_params": {parameter: project_id}})
        except OperationError as error:
            if error.status in {403, 404} or error.code == "invalid_arguments":
                return False
            raise
        return True

    return can_read
