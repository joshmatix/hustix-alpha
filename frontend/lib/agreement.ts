export const AGREEMENT_VERSION = '2026-10-17';

export const AGREEMENT_TITLE = 'Hustix Macro Customer Agreement';

export type AgreementSection = {
  heading: string;
  paragraphs: string[];
};

export const agreementSections: AgreementSection[] = [
  {
    heading: '1. This agreement & acceptance',
    paragraphs: [
      'This is the binding legal agreement between you and Hustix for the Hustix Macro service at hustix.com[cite: 1]. The version date is October 17, 2026.',
      'By clicking to create an account, subscribing, or using the service, you agree to this text. If you accept on behalf of a firm or RIA, you confirm that you have legal authority to bind that entity.',
    ],
  },
  {
    heading: '2. The service & nature of output',
    paragraphs: [
      'Hustix Macro lets a wealth advisor build portfolios and run scenario stress tests[cite: 1]. Results are quantitative calculations derived from user-entered information and third-party market data[cite: 3, 4, 5].',
      'All outputs, projections, and reports are strictly illustrations and simulations. They are not predictions, guarantees, financial advice, or a promise of how any portfolio or asset will perform.',
    ],
  },
  {
    heading: '3. Not investment advice & RIA responsibilities',
    paragraphs: [
      'Hustix is a technology provider, not a registered investment advisor, broker-dealer, or fiduciary. Hustix does not provide investment, tax, or legal advice, and Hustix is not an advisor to your clients.',
      'You retain sole discretion and responsibility for what information you present to clients, what strategies you deploy, and whether any calculation or report is fit for your professional use.',
    ],
  },
  {
    heading: '4. Your account',
    paragraphs: [
      'You need an account to use the service[cite: 1]. Keep your sign-in credentials secure and confidential. You are solely responsible for all activity and data uploads occurring under your account[cite: 1].',
    ],
  },
  {
    heading: '5. Information you upload & data privacy',
    paragraphs: [
      'You may store client and portfolio information in the service. You warrant that you have all necessary rights and client consents to upload this information and to allow Hustix to store and process it.',
      'Hustix uses uploaded data solely to provide, maintain, and secure the service and to comply with the law. Hustix does not sell your data.',
      'The service is not an official books-and-records retention system under SEC or FINRA regulations. You are solely responsible for maintaining your own firm compliance archives and official client records[cite: 2, 3].',
    ],
  },
  {
    heading: '6. Third-party data & market feeds',
    paragraphs: [
      'The service relies on external market data feeds, historical prices, and economic indicators from third-party providers (such as Yahoo Finance)[cite: 1, 3, 4].',
      'Hustix does not warrant the accuracy, timeliness, or completeness of third-party market data. Market data gaps, delayed feeds, or proxy calculation fallbacks[cite: 3] may impact simulation results, for which Hustix disclaims all liability.',
    ],
  },
  {
    heading: '7. Plans and fees',
    paragraphs: [
      'The plan you select is the one described on the account screen, including portfolio or feature limits[cite: 1]. A free plan carries no charge. A paid plan is billed monthly in advance at the price displayed upon signup.',
      'Fees already paid are strictly non-refundable, except where required by applicable law.',
    ],
  },
  {
    heading: '8. Acceptable use',
    paragraphs: [
      'Do not misuse the service, attempt unauthorized access, interfere with other accounts, scrape data, or use the service to violate any laws or regulations.',
    ],
  },
  {
    heading: '9. Disclaimers, liability caps, and indemnification',
    paragraphs: [
      'The service is provided on an "AS IS" and "AS AVAILABLE" basis without warranties of any kind, express or implied. Hustix expressly disclaims all implied warranties of merchantability and fitness for a particular purpose.',
      'To the maximum extent permitted by law, Hustix shall not be liable for any indirect, incidental, special, consequential, or punitive damages, including lost profits, lost AUM, or damaged client relationships.',
      'Hustix’s total cumulative liability for any claim arising out of or related to the service is strictly limited to the total fees you paid to Hustix for the service during the twelve (12) months immediately preceding the claim.',
      'You agree to defend, indemnify, and hold harmless Hustix, its officers, and suppliers from any third-party claims, lawsuits, liabilities, or regulatory penalties arising out of your breach of this agreement, your negligence, or any financial advice or reports you provide to your clients[cite: 2, 3].',
    ],
  },
  {
    heading: '10. Ending the agreement',
    paragraphs: [
      'You may stop using the service and close your account through the support contact shown after you sign in. Hustix may suspend or terminate any account that violates this agreement or poses security risks.',
      'Provisions concerning disclaimers, liability limitations, and indemnification survive the termination of your account.',
    ],
  },
  {
    heading: '11. Later versions & notices',
    paragraphs: [
      'Legal notices and agreement updates may be delivered via email to your registered account address[cite: 1]. Continued use of the service following notice constitutes acceptance of updated terms.',
    ],
  },
  {
    heading: '12. Governing law and contact',
    paragraphs: [
      'This agreement is governed by the laws of the State of Delaware, without regard to conflict-of-law rules.',
      'Questions regarding this agreement must be sent to the support contact shown in your account after you sign in.',
    ],
  },
];