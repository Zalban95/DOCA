'use strict';

/**
 * 3D and real-time engines as catalogue rows (asked 2026-10-17: "set up Unity and Unreal Engine to work with DOCA as
 * Blender does … they are amazing tools for many projects", not only games): Blender, and for Unity and Unreal both
 * the maker's own server and an open-source one beside it (P1: interchangeable, side by side), so a hive without the
 * maker's subscription or newest version still reaches its editor. Each is off until a person adds it; the skills
 * skills/unity and skills/unreal-engine say which to use, how to set up the editor's side and how to work in it.
 *
 * A server runs where its editor runs. On this machine a row is added here; when the editor is on another machine
 * (a desk with DocaDesk or doca-client), that machine's client hosts the server and lends it — Unreal's own server
 * answers loopback only and refuses another machine's Origin, so it cannot be reached across the network anyway.
 * Packages are pinned (catalog.js says why); `checked` is the day each pin was read from npm or PyPI.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

/** Where Unity's MCP relay is (unity.com/blog/unity-ai-mcp-how-to-get-started): installed by its AI Assistant package. */
function unityRelay(platform = process.platform, home = os.homedir()) {
  if (platform === 'win32') return path.join(home, '.unity', 'relay', 'relay_win.exe');
  if (platform === 'darwin') {
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
    return path.join(home, '.unity', 'relay', `relay_mac_${arch}.app`, 'Contents', 'MacOS', `relay_mac_${arch}`);
  }
  return path.join(home, '.unity', 'relay', 'relay_linux');
}

const ROWS = [
  { id: 'blender', label: 'Blender — 3D modelling, scenes, materials and renders',
    about: 'blender-mcp (MIT): the agent reads the scene, creates and changes objects and materials, runs Python in Blender '
      + 'and renders. Blender\'s side is the add-on from the project (addon.py: Edit → Preferences → Add-ons → Install, then '
      + '"Connect to MCP server" in the N panel), which listens on 127.0.0.1:9876 while Blender\'s window is open. Needs uv.',
    command: 'uvx', args: ['blender-mcp@2.0.0'], needs: ['uvx'], checked: '2026-10-17' },
  { id: 'unity', label: 'Unity — Unity\'s own MCP server (Unity 6, Unity AI)',
    about: 'Unity\'s server, through the relay its AI Assistant package installs: scenes and GameObjects, components, C# scripts, '
      + 'the console, build settings. Needs Unity 6 or later, the project connected to Unity Cloud and a Unity AI subscription or '
      + 'trial; Unity asks you to accept the first connection (Unity\'s Project Settings: AI, then Unity MCP). Without the subscription, '
      + 'use "MCP for Unity" beside it.',
    get command() { return unityRelay(); }, args: ['--mcp'], needs: [],
    present: () => fs.existsSync(unityRelay()), missingWhat: 'Unity\'s relay (Unity 6 with the AI Assistant package)', checked: '2026-10-17' },
  { id: 'mcp-for-unity', label: 'MCP for Unity — open-source server for Unity 2021.3 to 6',
    about: 'CoplayDev\'s MCP for Unity (MIT, independent of Unity): about fifty tools — scenes, GameObjects, components, C# scripts, '
      + 'assets, tests, profiling, builds. Unity\'s side is its package: Window → Package Manager → + → Add package from git URL '
      + '"https://github.com/CoplayDev/unity-mcp.git?path=/MCPForUnity#v10.3.0". No Unity subscription. Needs uv.',
    command: 'uvx', args: ['--from', 'mcpforunityserver==10.3.0', 'mcp-for-unity', '--transport', 'stdio'], needs: ['uvx'], checked: '2026-10-17' },
  { id: 'unreal', label: 'Unreal Engine — Epic\'s own Unreal MCP (5.8 and later)',
    about: 'Epic\'s server inside the Unreal Editor (Experimental in 5.8): actors, lighting, material instances, Slate widgets, '
      + 'automation tests. Enable the plugins "Unreal MCP" (ModelContextProtocol) and "All Toolsets" (Edit → Plugins); it '
      + 'answers on this machine only. Its default port is 8000, which this panel\'s speech-to-text also uses: set Editor '
      + 'Preferences → Model Context Protocol → Server Port Number to 8010, the address added here.',
    transport: 'http', url: 'http://127.0.0.1:8010/mcp', headers: {}, needs: [] },
  { id: 'enginewire', label: 'EngineWire — open-source server for Unreal Engine 5.0 to 5.8',
    about: 'EngineWire (MIT): one `unreal` tool searching and running about 400 editor capabilities — actors, Blueprints, materials, '
      + 'gameplay, cinematics. Unreal\'s side is its Automation Bridge plugin in the project (C++ projects; prebuilt binaries for '
      + 'Blueprint-only ones). Set UE_PROJECT_PATH in its environment to the project folder. Needs Node.',
    command: 'npx', args: ['-y', 'unreal-engine-mcp-server@0.5.30'], env: { UE_PROJECT_PATH: '' }, needs: ['npx'], checked: '2026-10-17' },
];

module.exports = { ROWS, unityRelay };
