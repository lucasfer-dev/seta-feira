export const VERSION = Object.freeze({
  core: '4.2.0',
  desktop: '2.6.0',
  deviceProtocol: 2,
  worldState: 2,
  architecture: '2026.09'
});

export function versionSnapshot() {
  return { ...VERSION };
}
