# ValdradaUE

Valdrada with the Unreal Engine 5 renderer. The headless core simulates the city (traffic, pedestrians, signals,
trains) and serves the Python API on port 2000; the renderer draws the core's state and answers the camera sensors.
Python scripts written for the three.js build run unchanged.

```
./ValdradaUE.sh                     (Windows: ValdradaUE.bat)
pip install ./PythonAPI
python PythonAPI/examples/quickstart.py
```

```python
import valdrada
client = valdrada.Client("localhost", 2000)
world = client.get_world()
```

`./ValdradaUE.sh --help` lists the options: the port, the window size (`--res`), the quality tier, `--offscreen` for
machines without a display, `--gpu`, and `--core-only` or `--renderer-only` to run the two halves on different
machines. Logs go to `logs/`. Ctrl+C stops both processes.

| Path | Contents |
|---|---|
| `ValdradaUE.sh`, `ValdradaUE.bat` | the launcher |
| `core/` | the headless core: a Node runtime, the simulation and API server, the compiled city's tiles |
| `renderer/` | the Unreal Engine 5 application and its cooked content (`renderer/ValdradaUE/Content/Paks/`) |
| `PythonAPI/` | the `valdrada` package and the examples |
| `fetch_valdrada_ue.py` | downloads, checks and assembles a release (`--verify` checks this folder) |

The full guide, with the system requirements and what differs from the three.js build, is `docs/ue-client.md`
(<https://mkturkcan.github.io/valdrada/ue-client/>). Licensing: `LICENSING.md` and `UNREAL_ENGINE_NOTICE.md`.
