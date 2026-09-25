from typing import Annotated

import dagger
from dagger import Doc, dag, function, object_type


@object_type
class TypesafeNodes:
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
