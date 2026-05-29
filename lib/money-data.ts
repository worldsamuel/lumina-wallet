export const defaultCurrencies = [
    { code:"USD", name:"US Dollar", symbol:"$",   rate:1.00 },
    { code:"EUR", name:"Euro", symbol:"€",        rate:0.92 },
    { code:"GBP", name:"British Pound", symbol:"£", rate:0.79 },
    { code:"JPY", name:"Japanese Yen", symbol:"¥", rate:155.0 },
    { code:"CNY", name:"Chinese Yuan", symbol:"¥", rate:7.20 },
    { code:"HKD", name:"Hong Kong Dollar", symbol:"HK$", rate:7.82 },
    { code:"TWD", name:"New Taiwan Dollar", symbol:"NT$", rate:32.5 },
    { code:"KRW", name:"Korean Won", symbol:"₩", rate:1350 },
    { code:"NGN", name:"Nigerian Naira", symbol:"₦", rate:1580 },
    { code:"ZAR", name:"South African Rand", symbol:"R", rate:18.6 },
    { code:"KES", name:"Kenyan Shilling", symbol:"KSh", rate:129 },
    { code:"EGP", name:"Egyptian Pound", symbol:"E£", rate:48.7 }
] as const;
