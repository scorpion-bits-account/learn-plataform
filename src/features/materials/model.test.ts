import { describe, expect, it } from 'vitest';

import { groupMaterialsByLesson, summarizeMaterials, toEditorMaterial } from './model';
import type { MaterialRow } from './model';

function row(over: Partial<MaterialRow> & { id: string; lesson_id: string }) {
  return {
    type: 'text',
    title: null,
    position: 0,
    body: null,
    external_url: null,
    video_provider: null,
    video_id: null,
    file_name: null,
    file_size: null,
    mime_type: null,
    show_in_all_lessons: false,
    ...over,
  } as MaterialRow & { lesson_id: string };
}

describe('toEditorMaterial', () => {
  it('mapeia snake_case para o modelo do editor, sem expor storage_path', () => {
    const m = toEditorMaterial(
      row({ id: 'm1', lesson_id: 'l1', type: 'video', video_provider: 'youtube', video_id: 'abc' }),
    );
    expect(m).toMatchObject({ id: 'm1', type: 'video', videoProvider: 'youtube', videoId: 'abc' });
    expect(m.showInAllLessons).toBe(false);
    expect(
      toEditorMaterial(row({ id: 'm2', lesson_id: 'l1', show_in_all_lessons: true }))
        .showInAllLessons,
    ).toBe(true);
    expect(m).not.toHaveProperty('storagePath');
    expect(m).not.toHaveProperty('lesson_id');
  });
});

describe('groupMaterialsByLesson', () => {
  it('agrupa por aula e ordena por position', () => {
    const grouped = groupMaterialsByLesson([
      row({ id: 'b', lesson_id: 'l1', position: 1 }),
      row({ id: 'c', lesson_id: 'l2', position: 0 }),
      row({ id: 'a', lesson_id: 'l1', position: 0 }),
    ]);
    expect(grouped['l1']?.map((m) => m.id)).toEqual(['a', 'b']);
    expect(grouped['l2']?.map((m) => m.id)).toEqual(['c']);
    expect(grouped['l3']).toBeUndefined();
  });
  it('lista vazia => objeto vazio', () => {
    expect(groupMaterialsByLesson([])).toEqual({});
  });
});

describe('summarizeMaterials', () => {
  it('conta por tipo com singular/plural em ordem fixa', () => {
    expect(summarizeMaterials([{ type: 'text' }, { type: 'video' }])).toBe('1 vídeo · 1 texto');
    expect(summarizeMaterials([{ type: 'text' }, { type: 'text' }, { type: 'file' }])).toBe(
      '2 textos · 1 arquivo',
    );
    expect(summarizeMaterials([{ type: 'link' }, { type: 'link' }])).toBe('2 links');
  });
  it('sem materiais => null', () => {
    expect(summarizeMaterials([])).toBeNull();
  });
});
