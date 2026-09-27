'use client';

import { ErrorView } from '../../error-view';

export default function SignInError({ reset }: { error: Error; reset: () => void }) {
  return <ErrorView reset={reset} />;
}
