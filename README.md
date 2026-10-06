# my blog

- [博客链接](https://al-shoukaku.github.io/)
- [框架: hexo](https://hexo.io/)
- [主题: butterfly](https://github.com/jerryc127/hexo-theme-butterfly)

## 访问统计

网站访客数、访问数和文章阅读数使用 [自建不蒜子的公共服务](https://busuanzi.9420.ltd/)。原不蒜子数据接口超时，因此改用独立的新服务重新计数，历史数据不继承。

- `_config.butterfly.yml` 的 `busuanzi` 开关控制计数是否显示。
- `CDN.option.busuanzi` 指向 `source/js/visit-counter.js`，复用主题现有元素，无需修改主题源码。
- 请求失败或超过 10 秒时显示 `—`，鼠标悬停可查看提示。
- `hexo server` 本地预览也会请求并显示计数。计数按访问地址区分，本地地址的统计与线上博客不同；`localhost` 等公共测试地址的数字可能包含其他网站的测试访问。
- 服务地址在统计脚本的 `API_URL` 中配置，访客标识保存在浏览器本地存储中。

修改后运行 `npm run build` 验证构建；推送到 `main` 后，GitHub Actions 会重新发布网站。
