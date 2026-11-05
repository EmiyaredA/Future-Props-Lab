"""Generation file layout remains independently replaceable and account-confined."""

import pytest

from studio.apps.model_service.catalog.visual_generation import VisualGenerationValidationError
from studio.apps.model_service.storage.visual_generation_files import VisualGenerationFiles


def test_separate_components_can_reopen_the_same_persisted_input(tmp_path):
    first = VisualGenerationFiles(tmp_path)
    directory = first.staging_root("alpha") / "plan-one"
    directory.mkdir()
    (directory / "asset").write_bytes(b"input")
    reopened = VisualGenerationFiles(tmp_path)
    assert reopened.input_path("alpha", "plan-one", "asset").read_bytes() == b"input"
    assert reopened.output_root("alpha") != reopened.output_root("beta")
    with pytest.raises(ValueError):
        reopened.input_path("beta", "plan-one", "asset")


@pytest.mark.parametrize("position", ["root", "account", "inputs", "batch", "asset", "outputs"])
def test_symlinks_cannot_borrow_another_accounts_or_external_files(tmp_path, position):
    files = VisualGenerationFiles(tmp_path / "models")
    source = tmp_path / "elsewhere"
    source.mkdir()
    (source / "asset").write_bytes(b"private")
    paths = {
        "root": files.root,
        "account": files.root / "alpha",
        "inputs": files.root / "alpha/inputs",
        "batch": files.root / "alpha/inputs/plan-one",
        "asset": files.root / "alpha/inputs/plan-one/asset",
        "outputs": files.root / "alpha/outputs",
    }
    link = paths[position]
    link.parent.mkdir(parents=True, exist_ok=True)
    link.symlink_to(source / "asset" if position == "asset" else source)
    error = VisualGenerationValidationError if position == "inputs" else ValueError
    with pytest.raises(error):
        if position == "outputs":
            files.output_root("alpha")
        else:
            files.input_path("alpha", "plan-one", "asset")
    assert (source / "asset").read_bytes() == b"private"


@pytest.mark.parametrize("value", ["", ".", "..", "../beta", "alpha/../beta", "alpha\\beta"])
def test_file_identifiers_cannot_change_directory_ownership(tmp_path, value):
    files = VisualGenerationFiles(tmp_path)
    with pytest.raises(ValueError):
        files.output_root(value)
    with pytest.raises(ValueError):
        files.input_path("alpha", value, "asset")
    with pytest.raises(ValueError):
        files.input_path("alpha", "plan-one", value)
