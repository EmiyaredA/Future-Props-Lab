"""HTTP glue binds the original signed request to job creation in the same transaction."""

from dataclasses import replace

from app.llm.admission import AdmissionProvider


def request_admission(ledger, authority, *, admit_tasks):
    def for_connection(connection):
        binding = ledger.bindings(admit_tasks=admit_tasks)

        async def attach(session, lease_id, kind, task_ids):
            await binding.attach(session, lease_id, kind, task_ids)
            await authority.retain(
                session,
                assertion=getattr(connection.state, "service_assertion", ""),
                actor=getattr(connection.state, "service_actor", None),
                method=connection.method,
                path=connection.url.path,
                kind=kind,
                task_ids=task_ids,
            )

        return replace(binding, attach=attach)

    return AdmissionProvider(for_connection=for_connection)
