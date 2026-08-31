import { TOLERANCE_PROFILES } from '../../domain/tolerance';
import { formatInches } from '../../domain/units';
import { currentPlatform, providerStatuses } from '../../measurement';
import {
  describePersistence,
  ensurePersistentStorage,
  formatBytes,
} from '../../platform/persistence';
import { Banner, Empty, TopBar, useAsync } from '../components';
import { hrefFor } from '../router';

export function SettingsScreen() {
  const { data } = useAsync(async () => providerStatuses(), []);
  // Re-requesting here is deliberate: iOS is more likely to grant persistence
  // once the user has actually used the app, so asking again on a screen they
  // opened themselves has a better chance than the start-up attempt alone.
  const { data: storage } = useAsync(async () => ensurePersistentStorage(), []);
  const platform = currentPlatform();

  return (
    <>
      <TopBar title="Settings" back={{ name: 'projects' }} />
      <main className="main">
        <h2>Measurement on this device</h2>
        <p className="muted">
          Running as <strong>{platformLabel(platform)}</strong>. The app uses the first available
          method in this list.
        </p>

        {!data && <Empty>Checking&hellip;</Empty>}
        {data?.map(({ provider, available, reason }) => (
          <div key={provider.id} className="card">
            <div className="row between">
              <h3>{provider.displayName}</h3>
              <span className={`pill ${available ? 'pass' : 'invalid'}`}>
                {available ? 'Available' : 'Unavailable'}
              </span>
            </div>
            <p className="muted">{available ? provider.accuracyNote : reason}</p>
          </div>
        ))}

        {platform !== 'ios' && (
          <Banner tone="warn">
            True dimensional measurement needs the depth sensor, which only exists on iOS. This
            build is for managing drawings, reviewing what the field captured, and issuing reports.
            Anything measured here from a photograph is indicative only.
          </Banner>
        )}

        <h2>Calibration</h2>
        <div className="card">
          <p className="muted">
            Measure the tool against a tape and find out whether it is accurate enough to inspect
            the tolerances above. Until that is done, the accuracy stated on every report is an
            estimate rather than a measurement.
          </p>
          <a className="btn primary btn-block" href={hrefFor({ name: 'calibration' })}>
            Calibration study
          </a>
        </div>

        <h2>Tolerance profiles</h2>
        <Banner tone="warn">
          These are editable starting values, not quotations from any standard. The governing
          tolerance is whatever the project specification and the engineer of record say. Set the
          real numbers per project before relying on a pass.
        </Banner>

        {TOLERANCE_PROFILES.map((profile) => (
          <div key={profile.id} className="card">
            <h3>{profile.name}</h3>
            <table className="metrics">
              <tbody>
                <tr>
                  <th>Framing bay spacing</th>
                  <td>&plusmn;{formatInches(profile.framing.spacingToleranceIn, 32)}</td>
                </tr>
                <tr>
                  <th>Framing cumulative drift</th>
                  <td>&plusmn;{formatInches(profile.framing.cumulativeToleranceIn, 32)}</td>
                </tr>
                <tr>
                  <th>Bar spacing</th>
                  <td>&plusmn;{formatInches(profile.rebar.spacingToleranceIn, 32)}</td>
                </tr>
                <tr>
                  <th>Clear cover, allowed reduction</th>
                  <td>{formatInches(profile.rebar.coverUnderToleranceIn, 32)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        ))}

        <h2>Data</h2>
        <p className="muted">
          Everything is stored on this device only. There is no account, no server, and nothing is
          uploaded. Move work between devices with the export and import buttons on a project.
        </p>

        {storage && (
          <div className="card">
            <div className="row between">
              <h3>Storage protection</h3>
              <span className={`pill ${storage.state === 'persisted' ? 'pass' : 'invalid'}`}>
                {storage.state === 'persisted' ? 'Protected' : 'Not guaranteed'}
              </span>
            </div>
            <p className="muted">{describePersistence(storage)}</p>
            {storage.usageBytes !== undefined && (
              <table className="metrics">
                <tbody>
                  <tr>
                    <th>Used on this device</th>
                    <td>{formatBytes(storage.usageBytes)}</td>
                  </tr>
                  <tr>
                    <th>Available to the app</th>
                    <td>{formatBytes(storage.quotaBytes)}</td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        )}
      </main>
    </>
  );
}

const platformLabel = (platform: string): string =>
  platform === 'ios' ? 'the iOS app' : platform === 'windows' ? 'the Windows desktop app' : 'a web browser';
