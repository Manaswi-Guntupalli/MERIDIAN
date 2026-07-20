import { useSearchParams } from 'react-router-dom';
import AttendanceLive from './AttendanceLive';
import History from './History';
import { Segmented } from './shared';

type View = 'live' | 'history';

const CAPTIONS: Record<View, string> = {
  live: 'Every scan from every source — RFID, manual and face — the moment it happens. Use manual correction to fix a mistake.',
  history: 'One student’s complete timeline: entries, exits, late arrivals and manual overrides.',
};

export default function PresenceActivity() {
  const [params, setParams] = useSearchParams();
  // A studentId in the URL (e.g. from a student profile link) implies history.
  const view: View = params.get('view') === 'history' || params.get('studentId') ? 'history' : 'live';

  const switchView = (v: View) => {
    if (v === 'live') setParams({});
    else {
      const next: Record<string, string> = { view: 'history' };
      const studentId = params.get('studentId');
      if (studentId) next.studentId = studentId;
      setParams(next);
    }
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented
          value={view}
          onChange={switchView}
          options={[
            { value: 'live', label: 'Live feed' },
            { value: 'history', label: 'Student history' },
          ]}
        />
        <p className="text-xs text-slate-500">{CAPTIONS[view]}</p>
      </div>
      {view === 'live' ? <AttendanceLive /> : <History />}
    </div>
  );
}
