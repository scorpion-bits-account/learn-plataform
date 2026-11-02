// PENDENTE DE REVISÃO JURÍDICA (REL-003 / STUDENT-008): texto-base gerado;
// revisar com advogado antes do lançamento. Não exibir este aviso na página.

import type { Metadata } from 'next';
import Link from 'next/link';

import { company } from '@/config/company';

import styles from '../legal.module.css';

const LAST_UPDATED = '8 de outubro de 2026';

export const metadata: Metadata = {
  title: 'Termos de uso',
  description:
    'Termos de uso da plataforma Scorpion Bits Learn: contratação de cursos, pagamento via PIX ou cartão, política de reembolso de 7 dias e regras de conduta.',
  alternates: { canonical: '/termos' },
  robots: { index: true, follow: true },
};

export default function TermosPage() {
  return (
    <article className={styles.article}>
      <div className={styles.prose}>
        <h1 className={styles.title}>Termos de uso</h1>
        <p className={styles.updated}>Última atualização: {LAST_UPDATED}</p>

        <p>
          Estes Termos regulam o uso da plataforma Scorpion Bits Learn, operada por{' '}
          <strong>{company.legalName}</strong> (CNPJ {company.cnpj}), marca{' '}
          <strong>{company.brand}</strong>, com sede em {company.address}. Ao criar uma conta ou
          comprar um curso, você concorda com estes Termos. Dúvidas: {company.email}.
        </p>

        <h2>1. Objeto</h2>
        <p>
          A plataforma oferece cursos online de desenvolvimento de jogos (game dev), com aulas em
          vídeo, textos, arquivos para download e links, acessados pelo navegador.
        </p>

        <h2>2. Conta e acesso</h2>
        <ul>
          <li>Para comprar ou acessar um curso é preciso criar uma conta com e-mail válido.</li>
          <li>
            O acesso é <strong>pessoal e intransferível</strong>: não é permitido compartilhar
            login, senha ou conteúdo com terceiros.
          </li>
          <li>
            Você é responsável pela segurança da sua conta e deve nos avisar caso suspeite de uso
            indevido.
          </li>
        </ul>

        <h2>3. Compra e pagamento</h2>
        <p>
          Os preços são exibidos antes da compra. O pagamento é feito via <strong>PIX</strong> ou{' '}
          <strong>cartão de crédito</strong>, processado pela AbacatePay. No cartão, os dados são
          digitados na página segura da AbacatePay e não passam pela plataforma. Ao concluir a
          compra, o acesso ao curso é liberado após a confirmação do pagamento pelo provedor. O
          preço cobrado é sempre o definido pela plataforma no momento da compra.
        </p>

        <h2>4. Política de reembolso</h2>
        <p>
          Em conformidade com o art. 49 do Código de Defesa do Consumidor (CDC), você pode solicitar
          o <strong>reembolso integral em até 7 dias corridos após a data da compra</strong>, sem
          precisar justificar o pedido.
        </p>
        <ul>
          <li>
            Para pedir o reembolso, acesse <strong>Minha conta → Meus pedidos</strong> e use a opção
            &quot;Solicitar reembolso&quot; no pedido, ou envie um e-mail para {company.email} com o
            assunto &quot;Reembolso&quot; e o e-mail da sua conta.
          </li>
          <li>
            Após a confirmação do reembolso pelo provedor de pagamento, o{' '}
            <strong>acesso ao curso comprado é removido</strong> da sua conta.
          </li>
          <li>
            Um curso reembolsado não pode ser reembolsado novamente caso seja comprado outra vez.
          </li>
          <li>
            Depois de 7 dias, pedidos de reembolso são analisados caso a caso, por decisão da
            equipe.
          </li>
        </ul>

        <h2>5. Conduta</h2>
        <p>Ao usar a plataforma, você se compromete a não:</p>
        <ul>
          <li>compartilhar, vender, redistribuir ou publicar o conteúdo dos cursos;</li>
          <li>tentar burlar controles de acesso, pagamento ou segurança;</li>
          <li>usar a plataforma para fins ilícitos ou que prejudiquem outros alunos;</li>
          <li>enviar conteúdo ofensivo, falso ou que viole direitos de terceiros.</li>
        </ul>
        <p>
          O descumprimento pode levar à suspensão ou encerramento da conta, sem prejuízo de outras
          medidas cabíveis.
        </p>

        <h2>6. Propriedade intelectual</h2>
        <p>
          Todo o conteúdo dos cursos (vídeos, textos, códigos, arquivos, imagens, marcas e
          identidade visual) pertence à {company.brand} ou a seus licenciantes e é protegido pela
          legislação de direitos autorais e de propriedade intelectual. Ao comprar um curso, você
          recebe uma licença pessoal, limitada e não exclusiva para estudo próprio, sem direito de
          revenda ou distribuição.
        </p>

        <h2>7. Alterações destes Termos</h2>
        <p>
          Podemos atualizar estes Termos. A data de &quot;última atualização&quot; no topo desta
          página indica a versão vigente. Alterações relevantes serão comunicadas por e-mail ou pela
          plataforma. Continuar usando o serviço após a mudança significa aceitá-la.
        </p>

        <h2>8. Contato</h2>
        <p>
          Dúvidas, pedidos de reembolso e solicitações sobre estes Termos podem ser enviados para{' '}
          <a href={`mailto:${company.email}`}>{company.email}</a>. Consulte também nossa{' '}
          <Link href="/privacidade">Política de privacidade</Link>.
        </p>

        <h2>9. Lei aplicável e foro</h2>
        <p>
          Estes Termos são regidos pela legislação brasileira. Fica eleito o foro da comarca de
          Araraquara/SP para dirimir eventuais conflitos, ressalvado o direito do consumidor de
          optar pelo foro de seu domicílio, nos termos do art. 101, I, do CDC.
        </p>
      </div>
    </article>
  );
}
