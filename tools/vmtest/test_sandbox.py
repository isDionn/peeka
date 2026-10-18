import xml.etree.ElementTree as ET
from pathlib import Path

import pytest

import sandbox


def test_wsb_xml_maps_only_given_folders(tmp_path):
    probe, out = tmp_path / "probe", tmp_path / "out"
    probe.mkdir()
    maps = sandbox.mappings(probe_dir=probe, notch_dir=tmp_path / "missing", out=out)
    root = ET.fromstring(sandbox.wsb_xml(maps))
    assert root.tag == "Configuration"
    assert root.findtext("Networking") == "Disable"
    folders = [(m.findtext("HostFolder"), m.findtext("SandboxFolder"), m.findtext("ReadOnly")) for m in root.iter("MappedFolder")]
    assert folders == [(str(probe), r"C:\probe", "true"), (str(out), r"C:\out", "false")]
    assert root.findtext("LogonCommand/Command").endswith(r"C:\out\agent.ps1")


def test_notch_dir_mapped_read_only_when_present(tmp_path):
    (tmp_path / "n").mkdir()
    maps = sandbox.mappings(probe_dir=tmp_path, notch_dir=tmp_path / "n", out=tmp_path / "o")
    assert (tmp_path / "n", r"C:\notch", True) in maps


def test_xml_escapes_paths(tmp_path):
    odd = tmp_path / "a&b<c"
    root = ET.fromstring(sandbox.wsb_xml([(odd, r"C:\out", False)]))
    assert root.findtext("MappedFolders/MappedFolder/HostFolder") == str(odd)


@pytest.mark.parametrize("p", [Path.home(), Path.home().parent])
def test_refuses_profile_root(p):
    with pytest.raises(ValueError):
        sandbox._check_host_path(p)


def test_default_mappings_are_allowed():
    assert [g for _, g, _ in sandbox.mappings()][0] == r"C:\probe"
