import os


def test_pgstrap_default_pglite_in_generate():
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    gen = open(os.path.join(base, "src", "generate.ts"), encoding="utf-8").read()
    assert "pglite = true" in gen
    assert "finally {" in gen
    assert "server.close" in gen


def test_pgstrap_cli_defaults_to_pglite_for_db_generate():
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    cli = open(os.path.join(base, "src", "cli.ts"), encoding="utf-8").read()
    assert "ctx.pglite ?? true" in cli
    assert '.option("postgres"' in cli


def test_pgstrap_define_config_includes_pglite():
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    cfg = open(os.path.join(base, "src", "define-config.ts"), encoding="utf-8").read()
    assert "pglite?: boolean" in cfg
    assert "migrationsDir?: string" in cfg
