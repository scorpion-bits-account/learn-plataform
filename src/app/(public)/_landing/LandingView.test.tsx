import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MOCK_COURSES } from '@/features/catalog/mock';

import { LandingView } from './LandingView';

describe('LandingView', () => {
  it('visitante: h1 único, CTAs "Ver cursos" e "Criar conta", cursos em destaque (máx. 3)', () => {
    render(<LandingView signedIn={false} courses={MOCK_COURSES} />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getAllByRole('link', { name: 'Ver cursos' })[0]).toHaveAttribute(
      'href',
      '/cursos',
    );
    expect(screen.getAllByRole('link', { name: 'Criar conta' })[0]).toHaveAttribute(
      'href',
      '/cadastro',
    );
    expect(
      screen.getByRole('heading', { level: 2, name: 'Cursos em destaque' }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 3 }).length).toBeGreaterThanOrEqual(3);
    expect(
      screen.getAllByRole('link', { name: /Godot do zero|Pixel art|Game design/ }),
    ).toHaveLength(3);
  });

  it('logado: "Minha biblioteca" no lugar de "Criar conta"', () => {
    render(<LandingView signedIn courses={[]} />);
    expect(screen.getByRole('link', { name: 'Minha biblioteca' })).toHaveAttribute(
      'href',
      '/minha-biblioteca',
    );
    expect(screen.queryByRole('link', { name: 'Criar conta' })).toBeNull();
  });

  it('sem cursos: a seção de destaque some', () => {
    render(<LandingView signedIn={false} courses={[]} />);
    expect(screen.queryByRole('heading', { name: 'Cursos em destaque' })).toBeNull();
    expect(
      screen.getByRole('heading', { level: 2, name: /Do primeiro acesso/ }),
    ).toBeInTheDocument();
  });
});
