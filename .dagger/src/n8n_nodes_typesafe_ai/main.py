from typing import Annotated

import dagger
from dagger import Doc, dag, function, object_type


@object_type
class N8NNodesTypesafeAi:
    @function(cache="never")
    async def wait_dagger_checks(
        self,
        repo: Annotated[str, Doc("GitHub repo as 'owner/name'")],
        ref: Annotated[str, Doc("Commit SHA to poll")],
        token: Annotated[dagger.Secret, Doc("GitHub token with read access")],
    ) -> str:
        """Wait for the repository's Dagger Cloud checks to succeed."""
        return (
            await dag.github()
            .status_monitor()
            .wait_for_dagger_checks(repo=repo, ref=ref, token=token)
        )


# Dagger's engine also looks for this spelling of the n8n prefix.
@object_type
class N8nNodesTypesafeAi(N8NNodesTypesafeAi):
    pass
