---
name: unity
description: Build and change real-time 3D or 2D in the Unity editor through its MCP server — product configurators, architectural walkthroughs, training simulations, digital twins, data visualisations, VR and AR, interactive installations and games. Which server to connect (Unity's own, or the open MCP for Unity), how to set up the editor's side, the loop that keeps a scene working (read, one change, wait for the compile, check the console, save), and the traps that lose work. Use whenever a request names Unity, a Unity project, scene, prefab or C# script for Unity.
triggers: [unity, unity editor, unity hub, unity project, unity scene, prefab, gameobject, monobehaviour, c# script unity, configurator, digital twin, walkthrough, vr app, ar app, realtime 3d, real-time 3d]
---

# Working in Unity

Unity is an engine for anything interactive in real time, not only games. The agent drives the editor through an MCP
server; the person keeps the editor open, signed in with their own Unity account.

## 1. Where it runs

A server runs on the machine where the editor runs. Look before choosing:

- On this machine: Settings → System → System tools has a Unity Hub row (found, or installed with this OS's command).
- On another machine (a desk with DocaDesk or doca-client): `doca_clients` shows it; that machine's client hosts the
  server and lends its tools, so add it there, not here.

## 2. Which server

Both are catalogue rows; propose the one that fits with `install_propose` `{kind: "mcp", id}` — a person's click adds it.

| id | what | needs |
|---|---|---|
| `mcp-for-unity` | open source (MIT), about fifty tools: scenes, GameObjects, components, C# scripts, assets, tests, profiling, builds | Unity 2021.3 to 6, uv; in Unity: Window → Package Manager → + → Add package from git URL `https://github.com/CoplayDev/unity-mcp.git?path=/MCPForUnity#v10.3.0` |
| `unity` | Unity's own server, through the relay its AI Assistant package installs | Unity 6+, the project linked to Unity Cloud, a Unity AI subscription or trial; accept the first connection in Project Settings → AI → Unity MCP |

No subscription: `mcp-for-unity`. The person already pays for Unity AI: `unity`. If one is connected, use it — do not
add the second. Start a stopped one with `mcp_connect`.

## 3. The loop

1. **Read first**: the scene hierarchy and the console. A console already full of errors means the project does not
   compile; fix that before anything else, or every later step reads as broken.
2. **One change**, then look at what it did (the hierarchy, the component's values, a screenshot of the Game or Scene view).
3. **After editing C#, wait for the compile** (a domain reload of a few seconds to a minute) and read the console again
   before using the new script. A tool call during the reload fails or acts on the old code.
4. **Save** the scene and the project. An unsaved scene is gone when the editor closes; a change made in Play mode is gone
   when Play stops — leave Play mode before editing what should stay.
5. **Show it**: a screenshot with `show_media`, or a build the person can open.

## 4. Traps

- **Assets move only inside Unity.** Moving or renaming a file in the folder (with the shell or file tools) breaks its
  `.meta` GUID and every reference to it. Use the editor's tools for assets; never edit `.meta` files.
- **Packages** live in `Packages/manifest.json`; adding one triggers an import and a compile — wait for both.
- **Big imports** (textures, models) take minutes. Wait for the editor to be idle, then check.
- **A build from the command line needs the project closed in the editor** (it holds a lock):
  `Unity -batchmode -quit -projectPath <project> -executeMethod <BuildClass>.<Method> -logFile -` (the build method is a C#
  script in an `Editor` folder; read the log for "Build succeeded").
- **Signing in is the person's.** Never ask for a Unity password: they sign in themselves, or take over the screen.

## 5. Keep what worked

A sequence that set up a project's scene or built it is a recipe (`recipe` save_last). A project's own conventions — its
folders, its render pipeline, its target platform — are a memory entry, so the next turn does not rediscover them.
