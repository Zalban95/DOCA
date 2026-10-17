---
name: unreal-engine
description: Build and change real-time 3D in the Unreal Editor through an MCP server — architectural visualisation, virtual production and previs, simulations, digital twins, product configurators, cinematics and games. Which server to connect (Epic's Unreal MCP in 5.8 or the open EngineWire for 5.0–5.8), how to set up the editor's side and its port, the loop that keeps a level working (read, one change, compile, save, look), and the traps that lose hours. Use whenever a request names Unreal, UE5, a level, a Blueprint or an Unreal project.
triggers: [unreal, unreal engine, ue5, ue 5, unreal editor, blueprint, level, uproject, metahuman, nanite, lumen, sequencer, archviz, virtual production, previs, digital twin, realtime 3d, real-time 3d]
---

# Working in Unreal Engine

Unreal is an engine for real-time 3D of any kind — film, architecture, simulation and products as much as games. The
agent drives the editor through an MCP server; the person keeps the editor open with their own Epic account.

## 1. Where it runs

A server runs where the editor runs, and Unreal's own answers only on that machine (it refuses another machine's
requests). So:

- On this machine: Settings → System → System tools has the Epic Games Launcher row (Windows and macOS; on Linux,
  Unreal comes from Epic's Linux download or its source).
- On another machine (a desk with DocaDesk or doca-client): `doca_clients` shows it; that machine's client hosts the
  server and lends its tools.

## 2. Which server

Both are catalogue rows; propose one with `install_propose` `{kind: "mcp", id}` — a person's click adds it.

| id | what | needs |
|---|---|---|
| `unreal` | Epic's Unreal MCP, inside the editor (Experimental in 5.8): actors, lighting, material instances, Slate widgets, automation tests | UE 5.8+; enable the plugins "Unreal MCP" and "All Toolsets" (Edit → Plugins); set Editor Preferences → Model Context Protocol → Server Port Number to 8010 (the catalogue's address — 8000, its default, is often taken: this panel's speech-to-text uses it) |
| `enginewire` | EngineWire, open source (MIT): one `unreal` tool that searches and runs about 400 capabilities — actors, Blueprints, materials, gameplay, cinematics | UE 5.0–5.8, Node; its Automation Bridge plugin in the project; `UE_PROJECT_PATH` set to the project folder in the server's environment (MCP tab) |

UE 5.8 or later: `unreal`. An older version, or Blueprint work Epic's tools do not reach yet: `enginewire`. Use what is
connected; start a stopped one with `mcp_connect`.

## 3. The loop

1. **Read first**: the level's actors and the Output Log. Shaders still compiling (the counter at the bottom right)
   means wait — a screenshot now shows grey placeholder materials.
2. **One change**, then look: the actor's properties, a viewport or high-resolution screenshot.
3. **Blueprints compile** before they run; read the compile result. **C++** needs a build — Live Coding for a body
   change, a full build (and an editor restart) for a new class or a changed header.
4. **Save all** (levels and assets). An unsaved level is gone when the editor closes or crashes.
5. **Show it**: a screenshot with `show_media`, a Sequencer render, or a packaged build.

## 4. Traps

- **Never edit `.uasset` or `.umap` files** with file or shell tools: they are binary and a broken one can take the
  project down. Change them through the editor; text config is in `Config/*.ini`.
- **Moving assets outside the editor** leaves redirectors and broken references. Move them in the Content Browser.
- **First opens and engine upgrades** compile shaders for many minutes; the editor answers slowly meanwhile.
- **Packaging** runs without the editor's window: `RunUAT BuildCookRun -project=<path>.uproject -platform=<Win64|Linux|Mac>
  -clientconfig=Shipping -build -cook -stage -pak -archive -archivedirectory=<out>` (RunUAT.bat on Windows, RunUAT.sh
  elsewhere, under the engine's `Engine/Build/BatchFiles`). It takes a long time: run it in the background and read its log.
- **Signing in is the person's.** Never ask for an Epic password: they sign in themselves, or take over the screen.

## 5. Keep what worked

A level set up or a project packaged that will come back is a recipe (`recipe` save_last). A project's conventions —
its engine version, render settings, target platform — are a memory entry.
