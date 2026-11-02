// PENDENTE DE REVISÃO JURÍDICA (REL-003 / STUDENT-008): texto-base gerado;
// revisar com advogado antes do lançamento. Não exibir este aviso na página.

import type { Metadata } from 'next';
import Link from 'next/link';

import { company } from '@/config/company';

import styles from '../legal.module.css';

const LAST_UPDATED = '9 de outubro de 2026';

export const metadata: Metadata = {
  title: 'Política de privacidade',
  description:
    'Como a Scorpion Bits Learn coleta, usa, compartilha e protege seus dados pessoais, em conformidade com a LGPD.',
  alternates: { canonical: '/privacidade' },
  robots: { index: true, follow: true },
};

export default function PrivacidadePage() {
  return (
    <article className={styles.article}>
      <div className={styles.prose}>
        <h1 className={styles.title}>Política de privacidade</h1>
        <p className={styles.updated}>Última atualização: {LAST_UPDATED}</p>

        <p>
          Esta política explica como tratamos seus dados pessoais na plataforma Scorpion Bits Learn,
          de acordo com a Lei Geral de Proteção de Dados (LGPD, Lei 13.709/2018).
        </p>

        <h2>1. Controlador</h2>
        <p>
          O controlador dos seus dados é <strong>{company.legalName}</strong>, CNPJ {company.cnpj},
          marca {company.brand}, {company.address}.
        </p>

        <h2>2. Dados que coletamos</h2>
        <div className={styles.tableWrap}>
          <table>
            <thead>
              <tr>
                <th scope="col">Dado</th>
                <th scope="col">Quando é coletado</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Nome e e-mail</td>
                <td>Ao criar a conta.</td>
              </tr>
              <tr>
                <td>CPF e telefone</td>
                <td>Somente na compra, para o pagamento via PIX.</td>
              </tr>
              <tr>
                <td>Progresso nas aulas</td>
                <td>Aulas concluídas, última aula visitada e percentual do curso.</td>
              </tr>
              <tr>
                <td>Dados de pedidos</td>
                <td>Valor, situação do pedido e identificadores do pagamento.</td>
              </tr>
              <tr>
                <td>Dados de sessão</td>
                <td>Cookies de sessão para manter você conectado.</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h2>3. Finalidades e bases legais</h2>
        <ul>
          <li>
            <strong>Criar e manter sua conta e liberar o acesso aos cursos</strong>: execução de
            contrato (art. 7º, V, LGPD).
          </li>
          <li>
            <strong>Processar pagamentos</strong> (nome, e-mail, CPF e telefone, enviados ao
            provedor PIX): execução de contrato (art. 7º, V).
          </li>
          <li>
            <strong>Guardar registros de pedidos e notas fiscais</strong>: cumprimento de obrigação
            legal ou regulatória (art. 7º, II).
          </li>
          <li>
            <strong>Registrar seu progresso</strong> para mostrar o andamento dos cursos: execução
            de contrato (art. 7º, V).
          </li>
          <li>
            <strong>Segurança e prevenção a fraudes</strong>, incluindo impedir reembolsos
            repetidos: legítimo interesse (art. 7º, IX).
          </li>
        </ul>
        <p>
          Não usamos seus dados para publicidade de terceiros nem tomamos decisões exclusivamente
          automatizadas que produzam efeitos jurídicos sobre você.
        </p>

        <h2>4. Compartilhamento</h2>
        <p>
          Seus dados são compartilhados somente com os seguintes operadores, na medida necessária:
        </p>
        <ul>
          <li>
            <strong>Supabase</strong>: banco de dados, autenticação e armazenamento de arquivos.
          </li>
          <li>
            <strong>AbacatePay</strong>: processamento dos pagamentos PIX (recebe nome, e-mail, CPF
            e telefone) e com cartão (os dados do cartão e do titular são informados diretamente à
            AbacatePay, na página dela).
          </li>
          <li>
            <strong>Vercel</strong>: hospedagem da aplicação.
          </li>
        </ul>
        <p>
          Esses provedores podem processar dados em servidores fora do Brasil, com as salvaguardas
          previstas na LGPD (art. 33).
        </p>

        <h2>5. Retenção</h2>
        <ul>
          <li>
            Dados da conta e do progresso são mantidos enquanto a conta existir. Ao encerrá-la, eles
            são excluídos ou anonimizados, salvo o que a lei exigir manter.
          </li>
          <li>
            Dados de pedidos e pagamentos são mantidos pelo prazo exigido pela legislação fiscal e
            contábil, mesmo após o encerramento da conta.
          </li>
        </ul>

        <h2>6. Seus direitos como titular</h2>
        <p>Nos termos do art. 18 da LGPD, você pode solicitar:</p>
        <ul>
          <li>confirmação de que tratamos seus dados e acesso a eles;</li>
          <li>correção de dados incompletos, inexatos ou desatualizados;</li>
          <li>anonimização, bloqueio ou eliminação de dados desnecessários ou excessivos;</li>
          <li>portabilidade dos dados a outro fornecedor;</li>
          <li>informação sobre com quem compartilhamos seus dados;</li>
          <li>revogação do consentimento, quando ele for a base legal.</li>
        </ul>
        <p>
          <strong>Excluir sua conta</strong>: você mesmo pode fazer isso em{' '}
          <Link href="/conta">Minha conta → Excluir conta</Link>. Apagamos seu nome, CPF, telefone e
          progresso nas aulas, encerramos o acesso aos cursos e desativamos o login. Os registros de
          pedidos e pagamentos são mantidos, ligados só a um identificador interno, pelo prazo
          exigido pela legislação fiscal e contábil (art. 16, I, LGPD). A exclusão não pode ser
          desfeita e fica indisponível enquanto houver um reembolso em andamento ou um pagamento PIX
          em aberto.
        </p>
        <p>
          Para exercer seus direitos, envie um e-mail para{' '}
          <a href={`mailto:${company.email}`}>{company.email}</a>. Responderemos no prazo previsto
          na LGPD.
        </p>

        <h2>7. Cookies</h2>
        <p>
          Usamos apenas cookies de sessão, necessários para manter você autenticado. Não usamos
          cookies de publicidade ou de rastreamento de terceiros.
        </p>

        <h2>8. Segurança</h2>
        <p>
          Adotamos medidas técnicas e administrativas para proteger seus dados, como controle de
          acesso no banco de dados, armazenamento privado de conteúdos pagos e transmissão
          criptografada.
        </p>

        <h2>9. Alterações e contato</h2>
        <p>
          Esta política pode ser atualizada; a data no topo indica a versão vigente. Para dúvidas
          sobre privacidade, escreva para <a href={`mailto:${company.email}`}>{company.email}</a>.
          Veja também os <Link href="/termos">Termos de uso</Link>.
        </p>
      </div>
    </article>
  );
}
