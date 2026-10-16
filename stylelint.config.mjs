export default {
  extends: ["stylelint-config-standard"],
  rules: {
    // Tailwind 的包导入必须保持字符串形式，url() 记法会让其解析器无法展开
    "import-notation": "string",
    // Tailwind v4 的编译指令
    "at-rule-no-unknown": [
      true,
      {
        ignoreAtRules: [
          "theme",
          "source",
          "utility",
          "variant",
          "custom-variant",
          "apply",
          "reference",
          "config",
          "plugin",
        ],
      },
    ],
    // 自定义属性名与 JS 常量保持一致，不做小写强制
    "custom-property-pattern": null,
    // 选择器嵌套深度等交给人工判断，关闭纯风格类限制
    "selector-class-pattern": null,
    "selector-id-pattern": null,
    "keyframes-name-pattern": null,
    // 规则按功能分区追加，级联顺序即视觉行为；强制按特异性排序需重排 90+ 条规则，回归风险大于收益
    "no-descending-specificity": null,
    // 同一选择器随功能分区多处出现是有意组织，不强制合并
    "no-duplicate-selectors": null,
  },
};
