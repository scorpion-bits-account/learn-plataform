import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const requestMaterialDownload = vi.fn();
vi.mock('../../actions', () => ({
  requestMaterialDownload: (input: unknown) => requestMaterialDownload(input),
  registerLessonVisit: vi.fn(),
}));

import { FileMaterial } from './FileMaterial';
import { LinkMaterial } from './LinkMaterial';
import { Materials } from './Materials';
import { TextMaterial } from './TextMaterial';
import { VideoMaterial } from './VideoMaterial';

beforeEach(() => vi.clearAllMocks());

describe('VideoMaterial', () => {
  it('mostra só o botão de play; o iframe (youtube-nocookie) só nasce após o clique', async () => {
    const { container } = render(
      <VideoMaterial provider="youtube" videoId="dQw4w9WgXcQ" title="Aula 1" />,
    );
    expect(container.querySelector('iframe')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Reproduzir vídeo: Aula 1' }));

    const frame = container.querySelector('iframe');
    expect(frame?.getAttribute('src')).toContain(
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
    );
    expect(frame?.getAttribute('title')).toBe('Aula 1 (vídeo do YouTube)');
    expect(frame?.getAttribute('allow')).toBe('autoplay; fullscreen; picture-in-picture');
    expect(frame).toHaveFocus();
  });

  it('Vimeo usa player.vimeo.com', async () => {
    const { container } = render(<VideoMaterial provider="vimeo" videoId="76979871" title="V" />);
    await userEvent.click(screen.getByRole('button'));
    expect(container.querySelector('iframe')?.getAttribute('src')).toMatch(
      /^https:\/\/player\.vimeo\.com\/video\/76979871\?/,
    );
  });

  it('id inválido ou provedor sem embed: aviso, sem iframe', () => {
    const { container } = render(
      <VideoMaterial provider="youtube" videoId='"><script>' title="V" />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('não pode ser exibido');
    expect(container.querySelector('iframe')).toBeNull();
  });
});

describe('TextMaterial', () => {
  it('renderiza markdown mínimo e nunca HTML cru', () => {
    const { container } = render(
      <TextMaterial
        body={[
          '# Título',
          '',
          'Texto com **negrito** e `código`.',
          '',
          '<script>alert(1)</script><img src=x onerror=alert(1)>',
          '',
          '- um',
          '- dois',
          '',
          '[ruim](javascript:alert(1)) e [bom](https://a.dev)',
        ].join('\n')}
      />,
    );
    expect(screen.getByRole('heading', { level: 3, name: 'Título' })).toBeInTheDocument();
    expect(container.querySelector('strong')?.textContent).toBe('negrito');
    expect(container.querySelectorAll('li')).toHaveLength(2);
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<script>alert(1)</script>');
    const links = [...container.querySelectorAll('a')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['https://a.dev/']);
    expect(links[0]?.getAttribute('rel')).toBe('noopener noreferrer');
  });
});

describe('LinkMaterial', () => {
  it('abre em nova aba com noopener noreferrer', () => {
    render(<LinkMaterial url="https://www.example.com/x" title="Docs" />);
    const link = screen.getByRole('link', { name: /Docs/ });
    expect(link).toHaveAttribute('href', 'https://www.example.com/x');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveTextContent('example.com');
    expect(link).toHaveTextContent('abre em nova aba');
  });
});

describe('FileMaterial', () => {
  it('mostra nome e tamanho e pede a URL assinada à action', async () => {
    requestMaterialDownload.mockResolvedValueOnce({
      ok: false,
      error: 'Arquivo não encontrado ou sem acesso.',
    });
    render(<FileMaterial materialId="m1" fileName="projeto.zip" fileSize={3_407_872} />);
    expect(screen.getByText('projeto.zip')).toBeInTheDocument();
    expect(screen.getByText('3,3 MB')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Baixar projeto\.zip/ }));
    expect(requestMaterialDownload).toHaveBeenCalledWith({ materialId: 'm1' });
    expect(await screen.findByRole('alert')).toHaveTextContent('sem acesso');
  });

  it('falha de rede vira mensagem e libera o botão de novo', async () => {
    requestMaterialDownload.mockRejectedValueOnce(new Error('offline'));
    render(<FileMaterial materialId="m1" fileName="a.zip" fileSize={null} />);
    await userEvent.click(screen.getByRole('button'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível baixar');
    expect(screen.getByRole('button')).toBeEnabled();
  });
});

describe('Materials', () => {
  it('sem materiais: estado vazio', () => {
    render(<Materials materials={[]} lockedHref="/cursos/x/acesso" />);
    expect(screen.getByRole('heading', { name: /ainda não tem materiais/ })).toBeInTheDocument();
  });

  it('cada material é uma região nomeada', () => {
    render(
      <Materials
        materials={[
          { id: 'a', type: 'text', title: 'Resumo', body: 'oi' },
          { id: 'b', type: 'link', title: null, url: 'https://a.dev/' },
        ]}
        lockedHref="/cursos/x/acesso"
      />,
    );
    expect(screen.getByRole('region', { name: 'Resumo' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Link' })).toBeInTheDocument();
  });

  it('material bloqueado da prévia leva à tela de compra, sem o endereço real', () => {
    render(
      <Materials
        materials={[{ id: 'c', type: 'locked', kind: 'file', title: 'Projeto final' }]}
        lockedHref="/cursos/astrodash/acesso"
      />,
    );
    const link = screen.getByRole('link', { name: /Projeto final/ });
    expect(link).toHaveAttribute('href', '/cursos/astrodash/acesso');
    expect(link).toHaveTextContent('Disponível para quem comprou o curso');
  });
});
