import { useSearchParams } from 'react-router-dom';
import Readers from './Readers';
import Cards from './Cards';
import Policy from './Settings';
import { Segmented } from './shared';

type Section = 'readers' | 'cards' | 'policy';

const CAPTIONS: Record<Section, string> = {
  readers: 'Gate hardware and its health. A reader stays Online only while it keeps sending heartbeats.',
  cards: 'Issue, replace, disable or reissue the RFID cards students carry.',
  policy: 'School start time, late grace, duplicate window and the reader offline threshold — one policy for every attendance source.',
};

export default function PresenceManage() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('section');
  const section: Section = raw === 'cards' || raw === 'policy' ? raw : 'readers';

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented
          value={section}
          onChange={(s) => setParams({ section: s })}
          options={[
            { value: 'readers', label: 'Readers' },
            { value: 'cards', label: 'Cards' },
            { value: 'policy', label: 'Policy' },
          ]}
        />
        <p className="text-xs text-slate-500">{CAPTIONS[section]}</p>
      </div>
      {section === 'readers' ? <Readers /> : section === 'cards' ? <Cards /> : <Policy />}
    </div>
  );
}
