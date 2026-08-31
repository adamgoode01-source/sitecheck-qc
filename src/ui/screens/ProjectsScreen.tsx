import { useState } from 'react';
import { createProject, listProjects, unexportedWork } from '../../storage/db';
import { importPackage } from '../../storage/transfer';
import { Banner, Empty, Field, TopBar, useAsync } from '../components';
import { hrefFor, navigate } from '../router';

export function ProjectsScreen() {
  const {
    data: projects,
    reload,
    loading,
  } = useAsync(
    async () =>
      Promise.all(
        (await listProjects()).map(async (project) => ({
          ...project,
          atRisk: (await unexportedWork(project.id)).count,
        })),
      ),
    [],
  );
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [message, setMessage] = useState<{ tone: 'info' | 'bad'; text: string } | null>(null);

  async function onCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || !location.trim()) return;

    const project = await createProject({ name: name.trim(), location: location.trim() });
    setName('');
    setLocation('');
    setAdding(false);
    navigate({ name: 'project', projectId: project.id });
  }

  async function onImport(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    try {
      const summary = await importPackage(file);
      setMessage({
        tone: 'info',
        text: `${summary.replacedExisting ? 'Updated' : 'Imported'} "${summary.projectName}" — ${summary.inspections} inspections, ${summary.planSheets} plan sheets. ${summary.warnings.join(' ')}`,
      });
      reload();
    } catch (e) {
      setMessage({ tone: 'bad', text: e instanceof Error ? e.message : String(e) });
    }
  }

  return (
    <>
      <TopBar
        title="Projects"
        actions={
          <a className="btn" href={hrefFor({ name: 'settings' })}>
            Settings
          </a>
        }
      />
      <main className="main">
        {message && <Banner tone={message.tone}>{message.text}</Banner>}

        {adding ? (
          <form className="card" onSubmit={onCreate}>
            <Field label="Project name">
              <input value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
            </Field>
            <Field label="Location" hint="Printed on every report from this project.">
              <input value={location} onChange={(e) => setLocation(e.target.value)} required />
            </Field>
            <div className="row">
              <button type="submit" className="primary grow">
                Create
              </button>
              <button type="button" onClick={() => setAdding(false)}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div className="row">
            <button className="primary grow" onClick={() => setAdding(true)}>
              New project
            </button>
            <label className="btn">
              Import package
              <input
                type="file"
                accept=".qcpkg,.zip"
                onChange={onImport}
                style={{ display: 'none' }}
              />
            </label>
          </div>
        )}

        <h2>Open projects</h2>

        {loading && <Empty>Loading&hellip;</Empty>}

        {!loading && projects?.length === 0 && (
          <Empty>
            No projects yet. Create one here, or import a <code>.qcpkg</code> package exported from
            a phone in the field.
          </Empty>
        )}

        {projects?.map((project) => (
          <a key={project.id} className="card tappable" href={hrefFor({ name: 'project', projectId: project.id })}>
            <div className="row between">
              <h3>{project.name}</h3>
              {project.atRisk > 0 ? (
                <span className="pill invalid">{project.atRisk} not exported</span>
              ) : (
                project.number && <span className="muted mono">{project.number}</span>
              )}
            </div>
            <div className="muted">{project.location}</div>
          </a>
        ))}
      </main>
    </>
  );
}
