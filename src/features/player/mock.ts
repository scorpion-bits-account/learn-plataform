import type { OutlineModule } from '@/features/catalog/model';

import type { PlayerMaterial } from './model';

/** Dados fictícios do player, só para a vitrine `/dev/player` (404 em produção). */

export const MOCK_COURSE = {
  slug: 'godot-do-zero',
  title: 'Godot do zero: seu primeiro jogo com um título bem comprido para testar o truncamento',
};

const lesson = (
  n: number,
  title: string,
  durationSeconds: number,
  isPreview = false,
  summary: string | null = null,
) => ({ id: `mock-lesson-${n}`, title, summary, durationSeconds, isPreview });

export const MOCK_MODULES: OutlineModule[] = [
  {
    id: 'mock-module-1',
    title: 'Primeiros passos',
    lessons: [
      lesson(1, 'Instalando a Godot', 540, true),
      lesson(
        2,
        'Cenas e nós',
        1260,
        true,
        'Tudo na Godot é um nó. Aqui você monta a cena do jogador e aprende a reaproveitar cenas dentro de outras.',
      ),
      lesson(3, 'Seu primeiro script', 900),
    ],
  },
  {
    id: 'mock-module-2',
    title: 'Movimento',
    lessons: [
      lesson(4, 'Input do jogador', 780),
      lesson(5, 'Física 2D', 1500),
      lesson(6, 'Animações', 1080),
    ],
  },
  {
    id: 'mock-module-3',
    title: 'Publicando',
    lessons: [lesson(7, 'Exportar para web', 660), lesson(8, 'Itch.io', 420)],
  },
];

export const MOCK_COMPLETED_IDS = ['mock-lesson-1'];
export const MOCK_ALL_COMPLETED_IDS = Array.from({ length: 8 }, (_, i) => `mock-lesson-${i + 1}`);

export const MOCK_MATERIALS: PlayerMaterial[] = [
  {
    id: 'mock-video',
    type: 'video',
    title: 'Aula em vídeo',
    provider: 'youtube',
    videoId: 'aqz-KE-bpKQ',
  },
  {
    id: 'mock-text',
    type: 'text',
    title: 'Resumo da aula',
    body: [
      '# O que é um nó?',
      '',
      'Na Godot, **tudo é um nó**. Nós organizados em árvore formam uma *cena*, e cenas podem ser instanciadas dentro de outras cenas.',
      '',
      '- `Node2D` para posição no mundo 2D',
      '- `Sprite2D` para exibir uma imagem',
      '- `CollisionShape2D` para colisões',
      '',
      '```gdscript',
      'extends Node2D',
      '',
      'func _ready():',
      '    print("Olá, Godot!")',
      '```',
      '',
      'Veja também a [documentação oficial](https://docs.godotengine.org).',
    ].join('\n'),
  },
  {
    id: 'mock-file',
    type: 'file',
    title: 'Projeto inicial',
    fileName: 'projeto-inicial-godot-4.zip',
    fileSize: 3_407_872,
    mimeType: 'application/zip',
  },
  {
    id: 'mock-link',
    type: 'link',
    title: 'Documentação da Godot',
    url: 'https://docs.godotengine.org/pt-br/stable/',
  },
];

/** Materiais "em todas as aulas" vindos de outras aulas (seção "Materiais do curso"). */
export const MOCK_COURSE_MATERIALS: PlayerMaterial[] = [
  {
    id: 'mock-course-link',
    type: 'link',
    title: 'Slides do curso',
    url: 'https://docs.google.com/presentation/d/exemplo',
  },
  {
    id: 'mock-course-file',
    type: 'file',
    title: 'Projeto Godot completo (com um nome bem comprido para testar o truncamento)',
    fileName: 'projeto-completo-godot-4-com-todos-os-assets-e-cenas.zip',
    fileSize: 18_874_368,
    mimeType: 'application/zip',
  },
];
