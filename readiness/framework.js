// Bid readiness framework: the questions, weights and scoring shared by the
// check (check.js) and the emailed report (report.js). Evidence base:
// "Charity and CIC bid readiness" research report, October 2026.
// Change VERSION whenever a question id, weight or section changes, so saved
// drafts from the old version are not resumed against the new one.
(() => {
  const VERSION = '2026.10';

  // Band edges follow the thresholds that matter: £25k (Lloyds Bank
  // Foundation floor), £40k (independent examination from Sep 2026), £100k
  // (Esmée Fairbairn floor), £1m (Children in Need core ceiling), £1.5m (audit).
  const INCOME = ['Under £10,000', '£10,000 to £25,000', '£25,000 to £40,000', '£40,000 to £100,000', '£100,000 to £250,000', '£250,000 to £500,000', '£500,000 to £1 million', '£1 million to £1.5 million', 'Over £1.5 million'];
  const INCOME_MID = [5e3, 17.5e3, 32.5e3, 70e3, 175e3, 375e3, 750e3, 1.25e6, 3e6];
  const AWARD = ['None yet', 'Under £10,000', '£10,000 to £50,000', '£50,000 to £100,000', '£100,000 to £250,000', '£250,000 to £500,000', '£500,000 to £1 million', 'Over £1 million'];
  const AWARD_MID = [0, 5e3, 30e3, 75e3, 175e3, 375e3, 750e3, 2e6];

  const LEGAL = {
    cio: 'Charitable incorporated organisation (CIO)',
    charco: 'Charitable company (registered charity and company)',
    unincCharity: 'Registered charity that is a trust or association',
    cicG: 'CIC limited by guarantee',
    cicS: 'CIC limited by shares',
    cbs: 'Community benefit society',
    group: 'Community group that is not registered',
    other: 'Something else or not sure',
  };
  const is = (org, ...keys) => keys.some(k => org.legal_form === LEGAL[k]);
  const isCharity = org => is(org, 'cio', 'charco', 'unincCharity');
  const isCic = org => is(org, 'cicG', 'cicS');
  const isCompany = org => is(org, 'charco', 'cicG', 'cicS');
  const hasStaff = org => !!org.paid_staff_band && org.paid_staff_band !== 'None, we are volunteer-led';
  const contracts = org => org.bid_type !== 'Grants only';
  const grants = org => !String(org.bid_type || '').startsWith('Contracts');
  const children = org => org.children !== 'No';
  const health = org => org.health === 'Yes';

  const profile = [
    { id: 'name', label: 'Organisation name', required: true, max: 200, autocomplete: 'organization', wide: true },
    { id: 'legal_form', label: 'Legal structure', required: true, options: Object.values(LEGAL), wide: true },
    { id: 'charity_number', label: 'Charity number', max: 20 },
    { id: 'company_number', label: 'Company number', max: 20 },
    { id: 'area', label: 'Where you work', hint: 'For example a borough, city or region.', max: 120 },
    { id: 'focus', label: 'Main focus', options: ['Children and young people', 'Families', 'Community and neighbourhoods', 'Health and wellbeing', 'Education, skills and employment', 'Arts, culture and sport', 'Something else'] },
    { id: 'income_band', label: 'Income last year', hint: 'Total income in your last full financial year.', required: true, options: INCOME },
    { id: 'years_operating_band', label: 'How long you have been running', required: true, options: ['Less than a year', '1 to 2 years', '3 to 5 years', '6 to 10 years', 'More than 10 years'] },
    { id: 'paid_staff_band', label: 'Paid staff', required: true, options: ['None, we are volunteer-led', '1 to 2', '3 to 5', '6 to 10', '11 to 25', 'More than 25'] },
    { id: 'volunteer_band', label: 'Regular volunteers', options: ['None', '1 to 10', '11 to 25', '26 to 50', 'More than 50'] },
    { id: 'largest_award_band', label: 'Largest single grant or contract won', required: true, options: AWARD },
    { id: 'target_bid_band', label: 'Size of bid you are aiming for', required: true, options: AWARD.slice(1) },
    // extra: no column of its own, so it travels in answers as _<id>.
    { id: 'bid_type', label: 'What you are preparing to bid for', required: true, extra: true, options: ['Grants only', 'Contracts with councils, the NHS or government', 'Both grants and contracts', 'Not sure yet'], wide: true },
    { id: 'children', label: 'Do you work with children or young people under 18?', required: true, extra: true, options: ['Yes', 'No'] },
    { id: 'health', label: 'Do you deliver, or plan to bid for, NHS or health services?', required: true, extra: true, options: ['Yes', 'No'] },
  ];

  const sections = [
    {
      id: "legal", title: "Legal structure and registration", weight: 12,
      intro: "The basics funders check before they read anything else: what kind of organisation you are and whether that is on record.",
      questions: [
        { id: "A1", short: "Incorporated legal body", text: "Is your organisation an incorporated body, such as a CIO, charitable company or CIC, rather than an unincorporated group?", help: "Unincorporated groups can't sign contracts or leases in their own name, and their trustees are personally liable.", weight: 3, blocker: true, when: contracts, fix: "Convert to a CIO (if charitable) or a CIC limited by guarantee before leading a contract bid. Until then, bid as a subcontractor to an incorporated partner.", source: "https://www.gov.uk/guidance/charity-types-how-to-choose-a-structure" },
        { id: "A2", short: "Signed governing document", text: "Do you have a signed governing document (constitution or articles) setting out your name, purposes and how decisions are made?", help: "Every funder asks for it. Branches of larger organisations need their own.", weight: 3, blocker: true, fix: "Adopt a model constitution suited to your legal form, tailor it, and get it signed and dated.", source: "https://www.tnlcommunityfund.org.uk/funding/funding-support/getting-ready-to-apply/preparing-your-application/what-your-organisation-needs-to-apply" },
        { id: "A3", short: "Registered with Charity Commission", text: "If you are a charity with income over £5,000, or a CIO, are you registered with the Charity Commission?", help: "Scout, Guide and some faith groups under £100,000 are \"excepted\" and can answer yes.", weight: 3, blocker: true, when: isCharity, fix: "Register online with the Charity Commission. A CIO does not legally exist until it is registered.", source: "https://www.gov.uk/guidance/how-to-set-up-a-charity-cc21a" },
        { id: "A4", short: "Purposes cover the work", text: "Do your written purposes clearly cover the work you want funding for, including work with children and young people?", help: "BBC Children in Need requires aims that don't exclude work with UK children and young people.", weight: 2, blocker: true, fix: "If your purposes are too narrow, amend them using the process in your governing document before you apply.", source: "https://www.bbcchildreninneed.co.uk/grants/apply/minimum-standards" },
        { id: "A5", short: "CIC names asset-lock recipient", text: "If you're a CIC, do your articles name the not-for-profit organisation that would receive your assets if you closed?", help: "BBC Children in Need holds back grant money until a recipient is named.", weight: 2, blocker: true, when: isCic, fix: "Update your articles to name an asset-locked body with similar aims, and file the change.", source: "https://www.bbcchildreninneed.co.uk/grants/apply/minimum-standards" },
        { id: "A6", short: "Records match everywhere", text: "Do your name, address and registration number match exactly across your governing document, bank account and public register?", help: "Mismatched register details are a common reason Lottery applications fail.", weight: 2, blocker: true, fix: "Correct whichever record is out of date so your legal name and details match exactly everywhere.", source: "https://www.tnlcommunityfund.org.uk/news/strengthening-your-awards-for-all-england-application-form" },
      ],
    },
    {
      id: "filings", title: "Filings and accounts", weight: 12,
      intro: "Funders look you up on the public registers. Anything overdue there is usually an automatic no.",
      questions: [
        { id: "B1", short: "Charity filings on time", text: "Did your charity file its last annual return and accounts with the Charity Commission within 10 months of your year end?", help: "Late filing shows on your public register entry, which funders check.", weight: 3, blocker: true, when: isCharity, fix: "File any overdue return now and set a reminder eight months after each year end.", source: "https://www.gov.uk/guidance/prepare-a-charity-annual-return" },
        { id: "B2", short: "Companies House up to date", text: "Are your accounts and confirmation statement at Companies House up to date, with nothing showing as overdue?", help: "Accounts are due nine months after year end, with penalties from £150 to £1,500. Software-only filing starts 1 April 2028.", weight: 3, blocker: true, when: isCompany, fix: "File overdue documents now, and choose bookkeeping software that can file accounts before April 2028.", source: "https://www.gov.uk/government/publications/life-of-a-company-annual-requirements/life-of-a-company-part-1-accounts" },
        { id: "B3", short: "CIC report filed", text: "If you're a CIC, did you file your community interest report (form CIC34) with your last accounts?", help: "Needed every year whatever your size, even if dormant. The fee is £15.", weight: 2, blocker: true, when: isCic, fix: "File CIC34 with your accounts. Use the detailed version to show community benefit and stakeholder involvement.", source: "https://www.gov.uk/government/publications/form-cic34-community-interest-company-report" },
        { id: "B4", short: "Directors' identity verified", text: "Have all your directors and people with significant control verified their identity with Companies House?", help: "Mandatory since 18 November 2025. Existing directors verify at the company's confirmation statement, with the transition ending around mid-November 2026.", weight: 3, blocker: true, when: isCompany, fix: "Each person verifies through the Companies House identity service. Confirm it on your next confirmation statement.", source: "https://www.gov.uk/government/news/companies-house-confirms-identity-verification-rollout-from-18-november-2025" },
        { id: "B5", short: "Recent full accounts", text: "Do you have signed accounts under 18 months old that include a balance sheet, not just micro-entity accounts?", help: "Groups under 15 months old can give a forecast instead. BBC Children in Need doesn't accept micro accounts.", weight: 3, blocker: true, na: "We are less than 15 months old", fix: "Prepare full accounts with an income statement and balance sheet, signed and dated by a board member.", source: "https://www.bbcchildreninneed.co.uk/grants/apply/minimum-standards" },
        { id: "B6", short: "Right level of checking", text: "Have your accounts had the independent examination or audit required by law, your governing document and your funders?", help: "For years ending on or after 30 September 2026, examination starts above £40,000 income and audit above £1.5 million.", weight: 2, blocker: true, when: isCharity, na: "None is required for our size", fix: "Check your income against the new thresholds, then check your constitution and grant terms, which may still require an examination.", source: "https://www.gov.uk/government/publications/charity-accounts/threshold-changes-at-a-glance" },
      ],
    },
    {
      id: "governance", title: "Governance", weight: 10,
      intro: "Who runs your organisation, and how independent they are of each other.",
      questions: [
        { id: "C1", short: "Two unrelated board members", text: "Do you have at least two board members or directors who aren't related, partners, or living at the same address?", help: "This is the National Lottery's minimum. Family-run CICs often fail it.", weight: 3, blocker: true, fix: "Recruit at least one independent trustee or director with no family or household link to the others.", source: "https://www.tnlcommunityfund.org.uk/funding/funding-programmes/national-lottery-awards-for-all-england/who-can-apply" },
        { id: "C2", short: "Three-person board", text: "Do you have at least three board members, with at least one independent of the others?", help: "BBC Children in Need's minimum. The Charity Commission recommends three unrelated trustees.", weight: 2, blocker: true, fix: "Recruit a third, independent board member, ideally with skills you lack such as finance or safeguarding.", source: "https://www.bbcchildreninneed.co.uk/grants/apply/minimum-standards" },
        { id: "C3", short: "Board eligibility checked", text: "Has every trustee or director signed a declaration that they are eligible and not disqualified?", help: "Disqualification covers things like undischarged bankruptcy and some unspent convictions. Check senior managers too.", weight: 2, blocker: true, fix: "Use the Charity Commission's eligibility declaration for each board member and senior manager, and keep it on file.", source: "https://www.gov.uk/government/publications/the-essential-trustee-what-you-need-to-know-cc3/the-essential-trustee-what-you-need-to-know-what-you-need-to-do" },
        { id: "C4", short: "Conflicts recorded", text: "Do you keep a conflicts of interest policy and a register of interests that's checked at every board meeting?", help: "The Commission relaunched its conflicts guidance in April 2026: identify, declare, remove, manage, record.", weight: 2, blocker: false, fix: "Adopt a short policy based on CC29, take declarations at the start of each meeting, and minute how each conflict was handled.", source: "https://www.gov.uk/government/publications/identifying-and-managing-conflicts-of-interest-in-a-charity-cc29/conflicts-of-interest-a-guide-for-charity-trustees" },
        { id: "C5", short: "Paid board members authorised", text: "If any board member is paid, is it allowed by your governing document, agreed in writing, and are fewer than half paid?", help: "BBC Children in Need requires all three. Charity trustees need legal authority to be paid.", weight: 2, blocker: true, na: "No board members are paid", fix: "Pause payments until authority and a written agreement are in place, or have the paid person step down from the board.", source: "https://www.bbcchildreninneed.co.uk/grants/apply/minimum-standards" },
        { id: "C6", short: "Governance health check", text: "Has your board reviewed how it works against the 2025 Charity Governance Code, or a similar checklist, in the last year?", help: "The Code is voluntary and has eight principles. CICs can use it as good practice.", weight: 1, blocker: false, fix: "Hold one board session working through the Code's principles or the Commission's \"15 questions\", and record actions.", source: "https://www.charitygovernancecode.org/" },
      ],
    },
    {
      id: "safeguarding", title: "Safeguarding", weight: 16,
      intro: "For anyone working with children and young people this is the area funders and commissioners check most closely. Several rules changed in 2026.",
      questions: [
        { id: "D1", short: "Own safeguarding policy", text: "Do you have a child safeguarding policy in your own organisation's name, reviewed in the last 12 months and published?", help: "It can't be a partner's or umbrella body's. Review it yearly and after any serious incident. Add an adults policy if you work with adults at risk.", weight: 3, blocker: true, when: children, fix: "Write your own policy using NSPCC or NYA standards as a base, get board approval, and publish it on your website.", source: "https://www.gov.uk/guidance/safeguarding-duties-for-charity-trustees" },
        { id: "D2", short: "Named safeguarding lead", text: "Have you named a senior, trained Designated Safeguarding Lead and a deputy?", help: "BBC Children in Need requires a named, senior, trained lead.", weight: 3, blocker: true, when: children, fix: "Appoint and train a lead and a deputy, and share their contact details with staff, volunteers and families.", source: "https://www.bbcchildreninneed.co.uk/grants/apply/minimum-standards" },
        { id: "D3", short: "Supervised volunteers DBS-checked", text: "Have all staff and volunteers who regularly work with children, including supervised volunteers, had an enhanced DBS check with barred list?", help: "The supervision exemption ended on 1 September 2026, so supervised volunteers meeting the frequency or overnight tests now need the full check.", weight: 3, blocker: true, when: children, fix: "List every volunteer role, re-assess it under the new rules, and apply for enhanced checks with children's barred list where needed.", source: "https://www.gov.uk/guidance/safeguarding-duties-for-charity-trustees" },
        { id: "D4", short: "DBS levels and re-checks", text: "Have you risk-assessed each role for the right DBS level, and do you re-check every three years or use the Update Service?", help: "BBC Children in Need expects background checks refreshed at least every three years in England.", weight: 2, blocker: true, when: children, fix: "Keep a DBS register showing role, level and check date, and ask staff and volunteers to join the DBS Update Service.", source: "https://www.bbcchildreninneed.co.uk/grants/apply/minimum-standards" },
        { id: "D5", short: "Training up to date", text: "Have all staff and volunteers had safeguarding training in the last three years, and do you keep a record?", help: "BBC Children in Need requires training refreshed at least every three years.", weight: 2, blocker: true, when: children, fix: "Keep a training record for everyone and book refreshers before anyone reaches three years.", source: "https://www.bbcchildreninneed.co.uk/grants/apply/minimum-standards" },
        { id: "D6", short: "Policy reflects 2026 law", text: "Does your policy reflect Working Together 2026 and the 2026 DBS changes, and explain how to refer concerns to the LADO and police?", help: "Policies citing Working Together 2023 or KCSIE 2025 are out of date. A mandatory duty to report child sexual abuse is coming but not yet in force.", weight: 2, blocker: false, when: children, fix: "Update references and referral routes, add online safety, and plan a review for when mandatory reporting starts.", source: "https://www.gov.uk/government/publications/working-together-to-safeguard-children--2/working-together-to-safeguard-children-2026-summary-of-changes" },
        { id: "D7", short: "Incident reporting process", text: "Do you have a written process for recording incidents and reporting serious ones to the Charity Commission, funders and safeguarding teams?", help: "Charities must report serious incidents \"as soon as reasonably possible\" and declare them in the annual return.", weight: 2, blocker: true, fix: "Write a one-page procedure naming who reports what, to whom and how fast, and keep an incident log.", source: "https://www.gov.uk/guidance/how-to-report-a-serious-incident-in-your-charity" },
      ],
    },
    {
      id: "insurance", title: "Insurance", weight: 8,
      intro: "What cover you hold now, and whether it could grow to the levels contracts ask for.",
      questions: [
        { id: "E1", short: "Employers' liability insurance", text: "If you employ anyone, do you hold employers' liability insurance of at least £5 million?", help: "This is a legal requirement. Many council tenders ask for £10 million.", weight: 3, blocker: true, when: hasStaff, fix: "Buy employers' liability cover now, display the certificate, and ask the insurer to cover volunteers too.", source: "https://www.hse.gov.uk/pubns/hse40.pdf" },
        { id: "E2", short: "Public liability insurance", text: "Do you hold public liability insurance of at least £5 million that also covers your volunteers?", help: "Councils such as Lambeth ask voluntary groups for £5 million. Some youth commissioners ask for £10 million.", weight: 3, blocker: true, fix: "Get quotes from a charity specialist broker for at least £5 million, with volunteers named as insured.", source: "https://www.lambeth.gov.uk/node/18630" },
        { id: "E3", short: "Abuse claims not excluded", text: "Has your insurer confirmed in writing that your policy doesn't exclude claims arising from abuse?", help: "This is a hidden gap for youth groups. Also check whether cover is claims-made or occurrence-based. Practice-based item.", weight: 2, blocker: false, when: children, fix: "Ask your broker for written confirmation of abuse cover and its basis, and change insurer if it is excluded.", source: "https://nya.org.uk/safeguarding-asset/insurance-overview/" },
        { id: "E4", short: "Professional indemnity insurance", text: "Do you hold professional indemnity insurance, typically £1–2 million, for the advice, mentoring or support you give?", help: "Council youth and voluntary sector tenders commonly ask for £2 million.", weight: 2, blocker: false, when: contracts, fix: "Add professional indemnity to your policy. It only has to be in place by contract start.", source: "https://www.lambeth.gov.uk/node/18630" },
        { id: "E5", short: "Cover can scale on award", text: "Has your broker confirmed they could raise your cover to tender levels, such as £10 million employers' liability, if you win?", help: "Buyers can't demand contract insurance before award, but it must be in place when the contract starts.", weight: 1, blocker: false, when: contracts, fix: "Get a broker's letter of intent with levels and cost, and build the extra premium into your price.", source: "https://www.gov.uk/government/publications/procurement-act-2023-guidance-documents-procure-phase/guidance-conditions-of-participation-html" },
      ],
    },
    {
      id: "policies", title: "Policies and data protection", weight: 10,
      intro: "The written policies funders ask to see, and the data protection rules that apply to everyone.",
      questions: [
        { id: "F1", short: "ICO fee paid", text: "Have you paid the ICO data protection fee this year, or recorded why you're exempt?", help: "Charities pay the lowest tier, £52 since February 2025. The not-for-profit exemption is narrow, and using CCTV removes it.", weight: 2, blocker: true, fix: "Check the exemption rules on the ICO website, then pay online or minute the exemption you rely on.", source: "https://ico.org.uk/for-organisations/data-protection-fee/" },
        { id: "F2", short: "Privacy notice and policy", text: "Do you have a data protection policy and a privacy notice explaining how you use young people's and families' information?", help: "Data protection law doesn't stop you sharing information to keep a child safe, but you must explain your approach.", weight: 2, blocker: false, fix: "Write a privacy notice for each group (young people, parents, staff) and a short policy on storage, sharing and retention.", source: "https://www.farrer.co.uk/news-and-insights/keeping-children-safe-in-education-2026-a-practical-guide-for-schools/" },
        { id: "F3", short: "Data complaints route", text: "Can people easily complain about how you handle their data, and do you acknowledge complaints within 30 days?", help: "This is a legal duty under the Data (Use and Access) Act 2025, in force since 19 June 2026.", weight: 2, blocker: true, fix: "Add a data complaints form or email address to your privacy notice, and log each complaint with the date you acknowledged it.", source: "https://www.mishcon.com/news/is-your-data-protection-complaints-process-ready-for-19-june-2026" },
        { id: "F4", short: "Health and safety", text: "Do you have a written health and safety policy and recorded risk assessments for sessions, trips and lone working?", help: "A written policy is law once you have five or more employees. Funders expect one whatever your size.", weight: 2, blocker: true, fix: "Write a short policy, name a responsible person, and keep dated risk assessments for each activity and venue.", source: "https://www.legislation.gov.uk/ukpga/1974/37/section/2" },
        { id: "F5", short: "Equality policy", text: "Do you have an equality, diversity and inclusion policy approved by your board?", help: "Public bodies pass their equality duty on to suppliers, so tenders almost always ask for one.", weight: 2, blocker: true, when: contracts, fix: "Adopt a short policy covering staff, volunteers and the people you serve, and say how you monitor it.", source: "https://www.legislation.gov.uk/ukpga/2010/15/section/149" },
        { id: "F6", short: "Core conduct policies", text: "Do you have written complaints, whistleblowing, code of conduct and anti-fraud policies that staff and volunteers know about?", help: "The Charity Commission expects these alongside safeguarding. Tenders often add anti-bribery and modern slavery statements.", weight: 1, blocker: false, fix: "Adopt short templates, tailor them to your size, brief everyone, and set an annual review date.", source: "https://www.gov.uk/guidance/safeguarding-duties-for-charity-trustees" },
      ],
    },
    {
      id: "money", title: "Money and financial controls", weight: 12,
      intro: "How your money is held, approved and planned.",
      questions: [
        { id: "G1", short: "Bank account in legal name", text: "Do you have a bank account in your organisation's exact legal name, with a statement from the last three months?", help: "A wrong bank statement is one of the most common reasons Lottery applications fail. A welcome letter works for new accounts.", weight: 3, blocker: true, fix: "Open a community or treasurer account in your legal name and stop using personal accounts for organisation money.", source: "https://www.tnlcommunityfund.org.uk/funding/funding-programmes/national-lottery-awards-for-all-england/what-we-need-to-know-when-you-apply" },
        { id: "G2", short: "Two unrelated payment approvers", text: "Do at least two unrelated people have to approve every payment, including online payments?", help: "Both the National Lottery and BBC Children in Need require two unrelated people.", weight: 3, blocker: true, fix: "Add a second unrelated signatory and switch on dual authorisation in online banking.", source: "https://www.bbcchildreninneed.co.uk/grants/apply/minimum-standards" },
        { id: "G3", short: "Able to pay debts", text: "At your last year end, did your cash and money owed to you cover what you owed in the coming year?", help: "BBC Children in Need checks that current assets are at least equal to current liabilities.", weight: 3, blocker: true, fix: "If not, agree a recovery plan with your board and include it, with current management accounts, in applications.", source: "https://www.bbcchildreninneed.co.uk/grants/apply/minimum-standards" },
        { id: "G4", short: "Restricted funds tracked", text: "Do your accounts show restricted and unrestricted funds separately?", help: "BBC Children in Need asks for this, or for its financial template to be completed.", weight: 2, blocker: false, fix: "Set up separate funds or tracking codes in your bookkeeping for each restricted grant.", source: "https://www.bbcchildreninneed.co.uk/grants/apply/minimum-standards" },
        { id: "G5", short: "Reserves policy", text: "Do you have a written reserves policy explaining how much you aim to hold and why?", help: "No regulator sets a figure. Three to six months of running costs is a rule of thumb, not a rule.", weight: 2, blocker: false, fix: "Agree a risk-based policy (e.g. covering staff notice periods or a funding gap) and report against it each year.", source: "https://www.gov.uk/government/publications/charities-and-reserves-cc19" },
        { id: "G6", short: "Budgets and full costs", text: "Do you set a yearly budget, review management accounts regularly, and price bids to cover a share of overheads?", help: "59% of charities subsidise public contracts from other income.", weight: 2, blocker: false, fix: "Build a full-cost budget template that adds a share of rent, management and insurance to every project.", source: "https://www.ncvo.org.uk/news-and-insights/news-index/rebalancing-relationship-final-report/commissioning-and-procurement-practice" },
      ],
    },
    {
      id: "impact", title: "Impact and track record", weight: 12,
      intro: "How you show what difference your work makes. This is where eligible bids win or lose.",
      questions: [
        { id: "H1", short: "Community helped shape it", text: "Can you show how young people or local people helped shape the project you're bidding for?", help: "The National Lottery checks whether plans \"came from listening to the community\".", weight: 3, blocker: false, fix: "Run a short consultation, youth panel or survey before applying, and quote what you heard in the bid.", source: "https://www.tnlcommunityfund.org.uk/news/strengthening-your-awards-for-all-england-application-form" },
        { id: "H2", short: "Theory of change", text: "Do you have a simple theory of change linking your activities to the outcomes you expect?", help: "Evidence-led funders such as the Youth Endowment Fund only fund work that is ready for evaluation.", weight: 2, blocker: false, fix: "Draw a one-page chain from need, to activities, to short- and longer-term changes, and say how you'll measure each.", source: "https://youthendowmentfund.org.uk/?p=7900" },
        { id: "H3", short: "Outcome data collected", text: "Do you collect outcome data, not just attendance, for the people you work with?", help: "Larger grants, such as Reaching Communities, and public buyers expect evidence of what changed.", weight: 3, blocker: false, fix: "Choose two or three simple before-and-after measures and collect them at the start and end of each programme.", source: "https://youngcamdenfoundation.org.uk/funding/the-national-lottery-community-fund-reaching-communities-england" },
        { id: "H4", short: "Three strong case studies", text: "Can you describe three similar projects from the last three years, with results and a named referee?", help: "Common in tenders. Buyers can ask about public-sector experience but not about work for them specifically. \"Three in three years\" is practice, not law.", weight: 2, blocker: false, fix: "Write three short case studies now, with numbers and quotes, and agree referees in advance.", source: "https://www.gov.uk/government/publications/procurement-act-2023-guidance-documents-procure-phase/guidance-conditions-of-participation-html" },
        { id: "H5", short: "Track record with target group", text: "Have you worked with the group your bid targets for at least a year?", help: "Lloyds Bank Foundation requires a year's track record. Comic Relief requires CICs to have run for two years.", weight: 2, blocker: false, fix: "Build a year of delivery on smaller grants first, or partner with an organisation that already has that record.", source: "https://homeless.org.uk/news/lloyds-bank-foundation-good-place-to-live-new-beginnings-fund/" },
        { id: "H6", short: "Quality mark", text: "Do you hold, or are you working towards, a quality mark such as the NYA Quality Mark, London Youth's or NCVO Trusted Charity?", help: "Not required, but recognised by many councils and funders. One 2025 match-fund scheme required Trusted Charity Level 1.", weight: 1, blocker: false, fix: "Start at the entry level of the mark that fits your work, and mention your progress in bids.", source: "https://londonyouth.org/what-we-do/quality-assurance/" },
      ],
    },
    {
      id: "contracts", title: "Public contracts readiness", weight: 8, when: contracts,
      intro: "What councils, the NHS and government buyers need under the Procurement Act 2023.",
      questions: [
        { id: "I1", short: "Registered on Find a Tender", text: "Have you registered on the government's Central Digital Platform (Find a Tender) and completed your supplier information?", help: "Since 1 April 2026, even winners of smaller notifiable contracts must be registered.", weight: 3, blocker: true, fix: "Create a GOV.UK One Login, register your organisation, complete all four sections, and note your unique ID.", source: "https://www.gov.uk/government/publications/procurement-act-2023-short-guides/how-to-register-your-organisation-and-find-your-unique-identifier-a-guide-for-suppliers-html" },
        { id: "I2", short: "No exclusion grounds", text: "Can you confirm no director, trustee or controlling person has a conviction or issue that triggers exclusion, such as fraud, bribery or tax offences?", help: "Exclusion can come from \"connected persons\", not just the organisation.", weight: 3, blocker: true, fix: "Get a short declaration from each board member. If something applies, document the steps taken to stop it happening again.", source: "https://www.gov.uk/government/publications/procurement-act-2023-guidance-documents-procure-phase/guidance-exclusions-html" },
        { id: "I3", short: "Cyber Essentials certificate", text: "Do you hold a current Cyber Essentials certificate, renewed every year?", help: "Required before award where a contract involves citizens' personal information, such as children's records.", weight: 2, blocker: true, fix: "Apply for Cyber Essentials certification, fix any gaps it finds, and set an annual renewal reminder.", source: "https://www.gov.uk/government/publications/ppn-014-cyber-essentials-scheme/ppn-014-cyber-essentials-scheme-html" },
        { id: "I4", short: "Social value evidence", text: "Can you describe, with numbers, the jobs, skills or training your work creates for young people or local people?", help: "From 1 January 2027, central government contracts of £1 million or more give social value at least 10% of marks.", weight: 2, blocker: false, fix: "Track apprenticeships, volunteering-to-work routes and accredited training, and prepare measurable commitments you can report on.", source: "https://www.gov.uk/government/publications/ppn-026-the-social-value-model" },
        { id: "I5", short: "NHS data toolkit done", text: "If you deliver or bid for NHS-funded services, have you completed this year's Data Security and Protection Toolkit?", help: "It's an annual requirement under the NHS Standard Contract, and some councils now ask for it too.", weight: 2, blocker: true, when: health, fix: "Register on the toolkit site and complete the assertions for your organisation type before bidding.", source: "https://www.dsptoolkit.nhs.uk/" },
        { id: "I6", short: "Cash to wait for payment", text: "Could you cover two to three months of delivery costs before the first contract payment arrives?", help: "Contracts pay in arrears. The law requires undisputed invoices to be paid within 30 days. The months figure is practice-based.", weight: 2, blocker: false, fix: "Model your cashflow before bidding, and negotiate monthly or upfront payment if your reserves are thin.", source: "https://www.wardhadaway.com/insights/procurement-in-a-nutshell/procurement-in-a-nutshell-supply-chain-payment-terms/" },
      ],
    },
  ];

  const VALUE = { yes: 1, partly: 0.5, no: 0, unsure: 0 };
  // The 80/60 cut-offs are a design choice, not sourced. Any essential item
  // not fully in place overrides the band, because funders treat those as
  // pass or fail whatever else is in place.
  const bands = [[80, 'Bid ready'], [60, 'Nearly there'], [0, 'Building foundations']];
  const bandText = {
    'Bid ready': 'You have the foundations most funders and commissioners check for. Focus on the gaps below to make your bids stand out.',
    'Nearly there': 'Most of the essentials are in place. Closing a few gaps would open up more and larger funding.',
    'Building foundations': 'You have made a start, but some basics funders check for are missing. Fixing them first will save wasted applications.',
    'Not yet eligible': 'Some essentials that funders treat as pass or fail are not fully in place. Fix those first; your score shows how much else you already have.',
  };

  // Capacity flags from the research appendix (CF1 to CF7). They advise on
  // bid size and route; they never change the score.
  function capacity(org) {
    const flags = [];
    const income = INCOME_MID[INCOME.indexOf(org.income_band)];
    const target = AWARD_MID[AWARD.indexOf(org.target_bid_band)];
    const largest = AWARD_MID[AWARD.indexOf(org.largest_award_band)];
    const money = n => (n >= 1e6 ? `£${(n / 1e6).toFixed(n % 1e6 ? 1 : 0)} million` : `£${Math.round(n / 1e3)},000`);
    if (income && target) {
      // CF1, sourced: Cabinet Office financial standing guidance treats income
      // under 1x the contract value as higher risk and over 2x as lower risk.
      if (contracts(org)) {
        if (income < target) flags.push('For contracts, your yearly income is lower than the contract value you are aiming for. Government guidance treats that as higher risk, so consider a smaller contract or lot, or a place in a consortium led by a larger organisation.');
        else if (income < target * 2) flags.push('For contracts, your income is less than twice the contract value you are aiming for. Buyers may ask how you would manage the risk, for example a partner, a guarantor or a smaller lot.');
      }
      // CF2, mixed: real caps of 20% (Freemasons' Charity) and 40% (Comic
      // Relief), applied here as a general rule of thumb.
      if (grants(org)) {
        if (target > income * 0.4) flags.push('For grants, the amount you are aiming for is more than 40% of your yearly income. Some funders cap a grant at 20% to 40% of income, so a smaller request, or a partnership bid, is likely to be stronger.');
        else if (target > income * 0.2) flags.push('For grants, the amount you are aiming for is between 20% and 40% of your yearly income. Some funders cap grants at that level, so check each funder’s limit before applying.');
      }
    }
    // CF3, heuristic: no funder publishes a step-up rule.
    if (target && largest !== undefined) {
      if (largest === 0 && target > 20e3) flags.push('You have not won a grant or contract yet. Smaller grants such as National Lottery Awards for All (up to £20,000) build the track record larger funders look for.');
      else if (largest > 0 && target > largest * 2.5) flags.push(`The bid you are aiming for is more than two and a half times the largest you have won (about ${money(largest)}). Funders look for a track record at a similar scale, so show how you will manage the step up, or bid alongside a partner.`);
    }
    // CF4, sourced: published income floors and ceilings.
    if (income && grants(org)) {
      if (income < 25e3) flags.push('With income under £25,000, some larger funders such as Lloyds Bank Foundation are closed to you for now. National Lottery Awards for All and local community foundations are good places to start.');
      else if (income < 100e3) flags.push('With income under £100,000, a few national funders such as Esmée Fairbairn are not open to you yet, but most youth and community funders are.');
      if (income > 1e6 && children(org)) flags.push('With income over £1 million, BBC Children in Need core grants are closed to you, so look at its other programmes and larger trusts.');
    }
    if (org.legal_form === LEGAL.cicS && grants(org)) flags.push('As a CIC limited by shares, you can apply to the National Lottery, but several youth funders, including BBC Children in Need and Comic Relief, only fund CICs limited by guarantee. Some trusts only fund registered charities.');
    if (org.legal_form === LEGAL.group && contracts(org)) flags.push('As an unregistered community group you cannot sign a contract in your own name. Bid as a partner or subcontractor to an incorporated organisation, or become a CIO or CIC first.');
    // CF5, sourced.
    if (org.years_operating_band === 'Less than a year') flags.push(contracts(org) ? 'Public buyers usually ask for accounts and examples of similar recent work, so newer organisations often do better starting with grants or as a subcontractor.' : 'Under 15 months old, you can usually give a forecast instead of accounts, for example to the National Lottery. Some funders, such as Lloyds Bank Foundation, need a year of track record first.');
    // CF6, heuristic.
    if (!hasStaff(org) && target >= 50e3) flags.push('Bids of £50,000 or more usually need paid staff to deliver them. Show who will manage the work, or include a paid coordinator in the budget.');
    // CF7, sourced (PPN 023 thresholds from 1 Jan 2026).
    if (contracts(org) && target >= 207720) flags.push('At this size, council and NHS contracts may come under the full Procurement Act rules (above £207,720, or £663,540 for youth, community and health services). Expect a formal tender with the Procurement Specific Questionnaire.');
    return flags;
  }

  function score(org, answers) {
    let total = 0, totalWeight = 0;
    const blockers = [], gaps = [];
    const out = sections.filter(s => !s.when || s.when(org)).map(s => {
      const qs = s.questions.filter(q => !q.when || q.when(org));
      let got = 0, max = 0;
      qs.forEach(q => {
        const a = answers[q.id];
        if (a === 'na') return;
        const v = VALUE[a] ?? 0;
        got += q.weight * v;
        max += q.weight;
        if (q.blocker && v < 1) blockers.push(q);
        if (v < 1) gaps.push({ ...q, lost: q.weight * (1 - v) * s.weight, sectionTitle: s.title });
      });
      const pct = max ? Math.round((100 * got) / max) : 100;
      total += pct * s.weight;
      totalWeight += s.weight;
      return { id: s.id, title: s.title, pct, questions: qs };
    });
    const overall = totalWeight ? Math.round(total / totalWeight) : 0;
    let band = bands.find(([min]) => overall >= min)[1];
    if (blockers.length) band = 'Not yet eligible';
    gaps.sort((a, b) => (b.blocker - a.blocker) || (b.lost - a.lost));
    return { score: overall, band, sections: out, blockers, gaps, capacity: capacity(org) };
  }

  window.READINESS = {
    version: VERSION,
    profile,
    sections,
    score,
    bandText,
    consent: {
      email: 'Email me Shvft2.0 news, funding opportunities, events and offers.',
      phone: 'Shvft2.0 can phone me about my results and how they could help.',
      notice: 'We will use your details to send your report and follow up on it. You can unsubscribe or ask us to delete your details at any time.',
    },
  };
})();
