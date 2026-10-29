import { useEffect } from 'react';
import { goBack, navigate, partPath, useRoute, type Route } from './router';
import { MoveFlow } from './screens/MoveFlow';
import { PartScreen } from './screens/PartScreen';
import { ResizeFlow } from './screens/ResizeFlow';
import { ScanScreen } from './screens/ScanScreen';
import { SearchScreen } from './screens/SearchScreen';
import { SwapFlow } from './screens/SwapFlow';
import { UnknownScreen } from './screens/UnknownScreen';
import { WhereScreen } from './screens/WhereScreen';

function PartRoutes({ route }: { route: Route }) {
  const [, id, view] = route.segments;
  const slot = route.query.get('slot');
  const toWhere = () => navigate(`${partPath(id)}/where`, undefined, true);
  const cancel = () => goBack(`${partPath(id)}`);
  switch (view) {
    case 'where':
      return <WhereScreen partId={id} />;
    case 'move':
      return (
        <MoveFlow
          key={`${id}-${slot}-${route.query.get('mode')}`}
          partId={id}
          fromSlotId={slot}
          initialChoice={route.query.get('mode') === 'add' ? 'keep' : 'leave'}
          onDone={toWhere}
          onCancel={cancel}
        />
      );
    case 'swap':
      return (
        <SwapFlow key={`${id}-${slot}`} partId={id} fromSlotId={slot} onDone={toWhere} onCancel={cancel} />
      );
    case 'resize':
      return (
        <ResizeFlow key={`${id}-${slot}`} partId={id} slotId={slot} onDone={toWhere} onCancel={cancel} />
      );
    default:
      return <PartScreen partId={id} />;
  }
}

export function App() {
  const route = useRoute();
  const [section, id, view] = route.segments;

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [section, id, view]);

  if (section === 'search') return <SearchScreen />;
  if (section === 'unknown' && id) return <UnknownScreen partId={id} />;
  if (section === 'part' && id) return <PartRoutes route={route} />;
  return <ScanScreen />;
}
