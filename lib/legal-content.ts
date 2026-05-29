export type LegalLanguage = "en" | "zh-CN";

export type LegalPageKind = "privacy" | "terms";

export type LegalSection = {
  title: string;
  body: string[];
};

export type LegalDocument = {
  title: string;
  subtitle: string;
  effectiveDate: string;
  lastUpdated: string;
  sections: LegalSection[];
};

export const legalContent: Record<LegalPageKind, Record<LegalLanguage, LegalDocument>> = {
  privacy: {
    en: {
      title: "Privacy Policy",
      subtitle: "How Lumina handles your data",
      effectiveDate: "May 29, 2026",
      lastUpdated: "May 29, 2026",
      sections: [
        {
          title: "Information We Collect",
          body: [
            "We may collect your wallet address, transaction history inside Lumina, device information such as model and operating system version, and IP address.",
          ],
        },
        {
          title: "Why We Collect It",
          body: [
            "We use this information to provide the Lumina service, meet compliance obligations including KYC and AML requirements where applicable, operate risk controls, prevent misuse, and improve the product experience.",
          ],
        },
        {
          title: "Information We Do Not Collect",
          body: [
            "Lumina never collects your private keys. Your wallet private keys never leave World App.",
            "Lumina does not collect biometric information. Any biometric or proof-of-humanity process is handled by World App or its own providers, not by Lumina.",
          ],
        },
        {
          title: "Data Storage",
          body: [
            "Lumina stores service data on servers in Australia, Sydney region, using Supabase encrypted storage and database security controls.",
          ],
        },
        {
          title: "Retention",
          body: [
            "Account data is retained until you request account deletion, subject to legal and operational requirements.",
            "Transaction records may be retained for seven years where compliance, audit, tax, or anti-money-laundering obligations require it.",
          ],
        },
        {
          title: "Your Rights",
          body: [
            "You may request access to, correction of, deletion of, or export of your personal data by contacting privacy@lumina.app.",
          ],
        },
        {
          title: "Third-Party Sharing",
          body: [
            "We share user data only when required for compliance, legal process, sanctions screening, fraud prevention, or regulator requests.",
            "We do not sell user data.",
          ],
        },
        {
          title: "Cookies and Tracking",
          body: [
            "Lumina uses only necessary cookies, such as session cookies required for login and security.",
            "Lumina does not use analytics cookies or advertising cookies.",
          ],
        },
        {
          title: "GDPR and CCPA",
          body: [
            "Where GDPR, CCPA, or similar privacy laws apply, Lumina will honor applicable rights, including access, portability, correction, deletion, objection, and opt-out rights where relevant.",
          ],
        },
        {
          title: "Policy Updates",
          body: [
            "If this Privacy Policy changes, Lumina will notify users through in-app announcements before or when the change takes effect.",
          ],
        },
        {
          title: "Contact",
          body: ["For privacy questions or requests, contact privacy@lumina.app."],
        },
      ],
    },
    "zh-CN": {
      title: "隐私政策",
      subtitle: "Lumina 如何处理你的数据",
      effectiveDate: "2026 年 5 月 29 日",
      lastUpdated: "2026 年 5 月 29 日",
      sections: [
        {
          title: "我们收集什么",
          body: ["我们可能会收集你的钱包地址、Lumina 内的交易历史、设备信息（包括设备型号和 OS 版本）以及 IP 地址。"],
        },
        {
          title: "为什么收集",
          body: ["我们使用这些信息来提供 Lumina 服务、满足适用的合规要求（包括 KYC/AML）、进行风控、防止滥用，并改进产品体验。"],
        },
        {
          title: "我们不收集什么",
          body: [
            "Lumina 不会收集你的私钥。钱包私钥从来不离开 World App。",
            "Lumina 明确不收集生物信息。任何生物识别或真人证明流程均由 World App 或其相关服务处理，而不是由 Lumina 处理。",
          ],
        },
        {
          title: "数据存储",
          body: ["Lumina 将服务数据存储在澳大利亚悉尼区域的服务器，并使用 Supabase 的加密存储和数据库安全控制。"],
        },
        {
          title: "保留期限",
          body: [
            "账户数据会保留至你申请账户注销，但仍受法律和运营要求约束。",
            "交易记录可能因合规、审计、税务或反洗钱要求保留 7 年。",
          ],
        },
        {
          title: "用户权利",
          body: ["你可以通过 privacy@lumina.app 请求访问、更正、删除或导出自己的个人数据。"],
        },
        {
          title: "第三方共享",
          body: [
            "我们仅在合规、法律程序、制裁筛查、欺诈防范或监管机构要求的情况下共享用户数据。",
            "我们不会出售用户数据。",
          ],
        },
        {
          title: "Cookies / 追踪",
          body: [
            "Lumina 只使用必要 cookies，例如登录和安全所需的 session cookies。",
            "Lumina 不使用分析 cookies 或广告 cookies。",
          ],
        },
        {
          title: "GDPR 与 CCPA",
          body: ["在 GDPR、CCPA 或类似隐私法律适用的情况下，Lumina 会尊重适用权利，包括访问、导出、更正、删除、反对处理以及相关选择退出权利。"],
        },
        {
          title: "更新机制",
          body: ["如果本隐私政策发生变更，Lumina 会在变更生效前或生效时通过 App 内公告通知用户。"],
        },
        {
          title: "联系方式",
          body: ["隐私相关问题或请求，请联系 privacy@lumina.app。"],
        },
      ],
    },
  },
  terms: {
    en: {
      title: "Terms of Service",
      subtitle: "Rules for using Lumina",
      effectiveDate: "May 29, 2026",
      lastUpdated: "May 29, 2026",
      sections: [
        {
          title: "Service Description",
          body: [
            "Lumina is a Mini App inside World App. Lumina is not a bank, broker, exchange, custodian, or deposit-taking service.",
            "Lumina does not hold user funds. Wallet control remains with the user through World App and connected blockchain protocols.",
          ],
        },
        {
          title: "User Responsibilities",
          body: [
            "You are responsible for protecting your World ID, wallet access, recovery phrase, and device security.",
            "If your World ID, recovery phrase, device, or account access is leaked or compromised, resulting losses are your responsibility unless applicable law requires otherwise.",
          ],
        },
        {
          title: "Crypto Asset Risks",
          body: [
            "Crypto asset prices can be highly volatile and may lose value quickly.",
            "Smart contracts, third-party protocols, bridges, liquidity pools, and blockchain networks may contain technical, economic, or security risks.",
          ],
        },
        {
          title: "Fees",
          body: [
            "Lumina may charge a 0.3% fee on Swap activity and a 0.5% Earn withdrawal fee. The exact fee shown inside the App at the time of use controls.",
          ],
        },
        {
          title: "Prohibited Conduct",
          body: [
            "You may not use Lumina for money laundering, terrorist financing, fraud, market manipulation, attacks against protocols, sanctions evasion, illegal transactions, or any activity prohibited by applicable law.",
          ],
        },
        {
          title: "Service Suspension",
          body: [
            "Lumina may suspend, restrict, or terminate access if you violate these Terms, if required by regulators or law enforcement, or if a technical or security incident requires protective action.",
          ],
        },
        {
          title: "Disclaimers",
          body: [
            "Lumina does not guarantee 100% availability, uninterrupted access, error-free operation, or any particular yield.",
            "Lumina does not endorse or guarantee third-party protocols, assets, contracts, networks, or services that may be displayed or accessed through the App.",
          ],
        },
        {
          title: "Governing Law and Dispute Resolution",
          body: [
            "These Terms are governed by the laws applicable to the Lumina operating entity, without regard to conflict-of-law rules. Disputes should first be raised with Lumina for good-faith resolution. If unresolved, disputes will be handled by the competent courts or arbitration forum designated by Lumina's operating entity, unless mandatory consumer law provides otherwise.",
          ],
        },
        {
          title: "Effective Date",
          body: ["These Terms are effective as of May 29, 2026."],
        },
      ],
    },
    "zh-CN": {
      title: "服务条款",
      subtitle: "使用 Lumina 的规则",
      effectiveDate: "2026 年 5 月 29 日",
      lastUpdated: "2026 年 5 月 29 日",
      sections: [
        {
          title: "服务说明",
          body: [
            "Lumina 是 World App 内的 Mini App。Lumina 不是银行、券商、交易所、托管机构或吸收存款的服务。",
            "Lumina 不持有用户资金。钱包控制权由用户通过 World App 和连接的区块链协议保留。",
          ],
        },
        {
          title: "用户责任",
          body: [
            "你有责任妥善保管自己的 World ID、钱包访问权限、恢复短语和设备安全。",
            "如果你的 World ID、恢复短语、设备或账户访问权限泄露或被盗，由此造成的损失由你自行承担，除非适用法律另有要求。",
          ],
        },
        {
          title: "加密资产风险",
          body: [
            "加密资产价格波动很大，可能在短时间内大幅贬值。",
            "智能合约、第三方协议、跨链桥、流动性池和区块链网络都可能存在技术、经济或安全风险。",
          ],
        },
        {
          title: "手续费",
          body: ["Lumina 可能对 Swap 收取 0.3% 手续费，对 Earn 提现收取 0.5% 手续费。具体费用以你使用时 App 内显示为准。"],
        },
        {
          title: "禁止行为",
          body: ["你不得使用 Lumina 进行洗钱、恐怖融资、欺诈、市场操纵、攻击协议、规避制裁、违法交易或任何适用法律禁止的活动。"],
        },
        {
          title: "服务中止条件",
          body: ["如果你违反本条款，或因监管、执法要求，或因技术安全事件需要采取保护措施，Lumina 可以暂停、限制或终止你的访问。"],
        },
        {
          title: "免责声明",
          body: [
            "Lumina 不保证 100% 可用、不保证服务不中断、不保证无错误运行，也不保证任何 yield 或收益。",
            "Lumina 不为 App 中展示或可访问的第三方协议、资产、合约、网络或服务作背书或担保。",
          ],
        },
        {
          title: "准据法和争议解决",
          body: [
            "本条款受 Lumina 运营实体适用法律管辖，不适用冲突法规则。争议应先提交 Lumina 进行善意协商；如未能解决，将由 Lumina 运营实体指定的有管辖权法院或仲裁机构处理，强制性消费者保护法律另有规定的除外。",
          ],
        },
        {
          title: "生效日期",
          body: ["本服务条款自 2026 年 5 月 29 日起生效。"],
        },
      ],
    },
  },
};

export function normalizeLegalLanguage(language: string | null | undefined): LegalLanguage {
  return language === "zh-CN" || language === "zh-TW" ? "zh-CN" : "en";
}
