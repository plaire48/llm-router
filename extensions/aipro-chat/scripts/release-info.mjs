// Chrome compares numeric versions; product releases may use a named beta.
// Keep packaging and verification on the same public artifact name.
export function releaseInfo(manifest, project) {
  const match = /^(\d+\.\d+\.\d+)(?:-([a-z]+)\.\d+)?$/.exec(project.version);
  if (!match || project.name !== manifest.short_name || !/^[a-z0-9-]+$/.test(project.name)) throw new Error('Invalid product release metadata');
  const expected = match[2] ? `${match[2][0].toUpperCase()}${match[2].slice(1)} ${match[1]}` : match[1];
  const displayVersion = manifest.version_name || manifest.version;
  if (displayVersion !== expected) throw new Error('Package and displayed extension release must match');
  return {name: project.name, version: project.version, displayVersion, extensionVersion: manifest.version,
    archiveStem: `${project.name}-${displayVersion.toLowerCase().replaceAll(' ', '-')}`};
}
