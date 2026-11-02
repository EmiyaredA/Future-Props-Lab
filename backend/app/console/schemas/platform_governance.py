from pydantic import BaseModel, Field

from app.llm.schemas.runtime_quotas import (
    GenerationQueueLimits as GenerationQueueLimits,
)
from app.llm.schemas.runtime_quotas import (
    QuotaLimit as QuotaLimit,
)
from app.llm.schemas.runtime_quotas import (
    RuntimeQuotas as RuntimeQuotas,
)
from app.llm.schemas.runtime_quotas import (
    RuntimeQuotasIn as RuntimeQuotasIn,
)
from app.llm.schemas.runtime_quotas import (
    RuntimeQuotasOut as RuntimeQuotasOut,
)

from .developer_documents import DeveloperDocumentOut as DeveloperDocumentOut
from .developer_documents import DeveloperDocumentsOut as DeveloperDocumentsOut
from .registration import (
    RedemptionOut as RedemptionOut,
)
from .registration import (
    RedemptionPage as RedemptionPage,
)
from .registration import (
    RegistrationIn as RegistrationIn,
)
from .registration import (
    RegistrationInviteAction as RegistrationInviteAction,
)
from .registration import (
    RegistrationInviteCreated as RegistrationInviteCreated,
)
from .registration import (
    RegistrationInviteIn as RegistrationInviteIn,
)
from .registration import (
    RegistrationInviteOut as RegistrationInviteOut,
)
from .registration import (
    RegistrationInvitePage as RegistrationInvitePage,
)
from .registration import (
    RegistrationInvitePatch as RegistrationInvitePatch,
)
from .registration import (
    SecretOut as SecretOut,
)


class CertificationIn(BaseModel):
    is_official: bool
    expected_revision: int = Field(ge=0)


class CertificationOut(BaseModel):
    id: str
    is_official: bool
    revision: int
