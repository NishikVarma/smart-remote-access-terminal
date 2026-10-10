# Python: ModuleNotFoundError and virtual environments

## Symptoms

`ModuleNotFoundError: No module named 'requests'` or `ImportError: cannot import name`.

## Likely causes

- The package is not installed in the interpreter that runs the script.
- The virtual environment is not activated, or pip belongs to a different Python.
- A local file shadows a library name, for example a file called `random.py`.

## Fix

Activate the environment, then run `python -m pip install <name>`. Check with `python -m pip list`.
Rename any local file that shadows a standard library module.
