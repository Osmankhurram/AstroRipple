'use client';
import dynamic from 'next/dynamic';

// Client-only: the demo mission's windows are generated from the visitor's clock at load time.
const App = dynamic(() => import('@/components/App'), {
  ssr: false,
  loading: () => <div className="boot">Loading Launch Detective…</div>,
});

export default function Page() {
  return <App />;
}
