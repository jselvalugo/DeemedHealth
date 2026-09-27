import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PreviewBanner } from './PreviewBanner.js';

describe('PreviewBanner', () => {
  it.each(['development', 'local', 'preview', 'staging', undefined, '', 'Production', 'prod'])(
    'shows when DH_ENV=%s',
    (env) => {
      render(<PreviewBanner env={env} locale="en" />);
      const banner = screen.getByRole('region', { name: 'Preview environment' });
      expect(banner.textContent).toContain(
        'PREVIEW · Synthetic data only. Do not enter real patient information.',
      );
    },
  );

  it('is hidden only when DH_ENV is exactly "production"', () => {
    const { container } = render(<PreviewBanner env="production" locale="en" />);
    expect(container.innerHTML).toBe('');
    expect(screen.queryByTestId('preview-banner')).toBeNull();
  });

  it('is translated', () => {
    render(<PreviewBanner env="development" locale="es" />);
    expect(screen.getByTestId('preview-banner').textContent).toContain('VISTA PREVIA');
  });
});
