# B类比赛网站抓取记录

抓取日期：2026-10-09。对应 [84项完整目录](./B类比赛清单与网站整理.md)；文字网址与二维码分别保留。

已尝试全部78个不同文字网址，并补抓不同的二维码入口；共123个不同入口。83张二维码中解码成功82张，第57项图像模糊未识别；第69项二维码错配，不作为能源经济比赛入口。

按84项赛事统计：已获取正文48项；访问失败29项；原目录未提供网页入口1项；访问验证3项；正文不足1项；二维码未能识别1项；需登录1项。抓到正文仅表示页面可读，不表示已经确认当届规则或报名资格。部分站点是往届页面、机构首页或系统入口，已在逐项记录中注明。

额外抓取了21份可读详情样本（含通知、章程、结果或系统公告）。选取网页当前列出的链接作为样本，未保证它是整个官网时间上最新的一条；页面显示的日期与年份应再核对。图片通知、PDF附件、需登录页面未在本轮解析。

完整正文存储在本机 `data/sources/2026-10-09/catalog/` 与 `catalog-qr/`，每条保留原入口、实际跳转、抓取时间、正文、链接、正文SHA-256和失败原因。共享入口只抓取一次，再映射到各比赛。原始正文未上传GitHub，本轮未写入生产知识库或建立定时任务。机器可读结果见 [抓取结果JSON](./b-category-crawl-results-2026-10-09.json)。

| 序号 | 比赛 | 本轮结果 | 已获取页面／最终入口 | 正文字符数 | 备注 |
| ---: | --- | --- | --- | ---: | --- |
| 1 | 中国国际大学生创新大赛 | 已获取正文 | [全国大学生创业服务网](https://cy.ncss.cn/) | 2313 | — |
| 2 | “挑战杯”全国大学生课外学术科技作品竞赛 | 已获取正文 | [挑战杯 全国大学生课外学术科技作品竞赛和创业计划大赛 官方网站](https://www.tiaozhanbei.net/) | 2594 | 二维码与第3项共享挑战杯官网；需要区分课外学术科技赛与创业计划赛的通知。 |
| 3 | “挑战杯”中国大学生创业计划大赛 | 已获取正文 | [挑战杯 全国大学生课外学术科技作品竞赛和创业计划大赛 官方网站](https://www.tiaozhanbei.net/) | 2594 | 文字入口访问失败，二维码指向挑战杯共享官网，可获取创业计划竞赛通知。 |
| 4 | ACM-ICPC国际大学生程序设计竞赛 | 已获取正文 | [The ICPC International Collegiate Programming Contest](https://icpc.global/) | 6263 | — |
| 5 | 全国大学生数学建模竞赛 | 已获取正文 | [全国大学生数学建模竞赛](https://www.mcm.edu.cn/) | 1051 | — |
| 6 | 全国大学生电子设计竞赛 | 访问失败 | — | 0 | — |
| 7 | 中国大学生医学技术技能大赛 | 原目录未提供网页入口 | — | 0 | — |
| 8 | 全国大学生机械创新设计大赛 | 已获取正文 | [机械创新设计大赛网站](https://11umic.hust.edu.cn/index.htm) | 2235 | — |
| 9 | 全国大学生结构设计竞赛 | 访问失败 | — | 0 | — |
| 10 | 全国大学生广告艺术大赛 | 已获取正文 | [全国大学生广告艺术大赛](https://www.sun-ada.net/) | 397 | — |
| 11 | 全国大学生智能汽车竞赛 | 已获取正文 | [飞思卡尔杯-全国大学生智能车竞赛](https://www.eepw.com.cn/event/action/freescale_car2012/) | 1764 | 文字网址为2012年智能车专题，不能作为2026届次依据。 |
| 12 | 全国大学生电子商务“创新、创意及创业”挑战赛 | 已获取正文 | [三创赛](https://www.3chuang.net/#/home) | 1659 | — |
| 13 | 中国大学生工程实践与创新能力大赛 | 访问失败 | — | 0 | — |
| 14 | 全国大学生物流设计大赛 | 已获取正文 | [北京中物联物流采购培训中心](https://www.clpp.org.cn/) | 1804 | 文字入口为机构首页，未从首页确认当前物流设计大赛通知。 |
| 15 | “外研社·国才杯”“理解当代中国”全国大学生外语能力大赛-①英语演讲、②英语辩论、③英语写作、④英语阅读 | 已获取正文 | [理解当代中国](https://ucc.fltrp.com/) | 1085 | 文字入口展示2023年旧版赛事页面，二维码另列入口。 |
| 16 | 两岸新锐设计竞赛·华灿奖 | 访问失败 | — | 0 | — |
| 17 | 全国大学生创新创业训练计划年会展示 | 访问失败 | — | 0 | — |
| 18 | 全国大学生化工设计竞赛 | 已获取正文 | [全国大学生化工设计竞赛 - 全国大学生化工设计竞赛](https://iche.zju.edu.cn/) | 2176 | — |
| 19 | 全国大学生机器人大赛(CURC) | 访问失败 | — | 0 | — |
| 20 | 全国大学生市场调查与分析大赛 | 访问失败 | — | 0 | — |
| 21 | 全国大学生先进成图技术与产品信息建模创新大赛 | 访问失败 | — | 0 | — |
| 22 | 全国三维数字化创新设计大赛 | 已获取正文 | [全国3D大赛-首页](https://3dds.3ddl.net/) | 4036 | — |
| 23 | “西门子杯”中国智能制造挑战赛 | 已获取正文 | [“西门子杯”中国智能制造挑战赛官网](https://www.siemenscup-cimc.org.cn/) | 666 | — |
| 24 | 中国大学生服务外包创新创业大赛 | 已获取正文 | [大学生服务外包——创新创业大赛](https://www.fwwb.org.cn/) | 1685 | — |
| 25 | 中国大学生计算机设计大赛 | 已获取正文 | [中国大学生计算机设计大赛](https://jsjds.blcu.edu.cn/) | 965 | — |
| 26 | 中国高校计算机大赛-①大数据挑战赛、②团体程序设计天梯赛、③移动应用创新赛、④网络技术挑战赛、⑤人工智能创意赛 | 访问失败 | — | 0 | — |
| 27 | 蓝桥杯全国软件和信息技术专业人才大赛 | 已获取正文 | [蓝桥杯大赛 — 全国大学生TMT行业赛事](https://dasai.lanqiao.cn/) | 2814 | — |
| 28 | 米兰设计周--中国高校设计学科师生优秀作品展 | 访问失败 | — | 0 | — |
| 29 | 全国大学生地质技能竞赛 | 已获取正文 | [地质技能竞赛](https://yuanxi.cugb.edu.cn/competition/) | 983 | 页面展示历史赛事与2021年教学动态，当前届次待核对。 |
| 30 | 全国大学生光电设计竞赛 | 访问失败 | — | 0 | — |
| 31 | 全国大学生集成电路创新创业大赛 | 访问验证 | [可疑请求拦截通知](https://univ.ciciec.com/) | 33 | — |
| 32 | 全国大学生金相技能大赛 | 已获取正文 | [大学生金相技能大赛](https://www.jxds.tech/#/) | 1652 | — |
| 33 | 全国大学生信息安全竞赛 | 访问失败 | — | 0 | — |
| 34 | 未来设计师·全国高校数字艺术设计大赛 | 已获取正文 | [未来设计师·全国高校数字艺术设计大赛（NCDA）](https://www.ncda.org.cn/) | 2289 | — |
| 35 | 全国周培源大学生力学竞赛 | 访问失败 | — | 0 | — |
| 36 | 中国大学生机械工程创新创意大赛 | 访问失败 | — | 0 | — |
| 37 | 中国机器人大赛暨RoboCup机器人世界杯中国赛 | 访问失败 | — | 0 | — |
| 38 | “中国软件杯”大学生软件设计大赛 | 已获取正文 | [软件杯大赛官网](https://www.cnsoftbei.com/) | 1619 | — |
| 39 | 中美青年创客大赛 | 已获取正文 | [中美青年创客大赛](https://chinaus-maker.cscse.edu.cn/) | 1557 | — |
| 40 | 睿抗机器人开发者大赛（RAICOM） | 已获取正文 | [睿抗(RoboCom)](https://www.robocom.com.cn/) | 122 | — |
| 41 | “大唐杯”全国大学生新一代信息通信技术大赛 | 访问失败 | — | 0 | — |
| 42 | 华为ICT大赛 | 已获取正文 | [ICT大赛](https://e.huawei.com/cn/talent/ict-academy/#/ict-contest?compId=85131973) | 2091 | — |
| 43 | 全国大学生嵌入式芯片与系统设计竞赛 | 已获取正文 | [嵌入式芯片与系统设计竞赛首页-嵌入式芯片与系统设计竞赛官网-嵌入式暨智能互联大赛官网](https://www.socchina.net/) | 146 | — |
| 44 | 全国大学生生命科学竞赛（CULSC） | 已获取正文 | [全国大学生生命科学竞赛](https://www.culsc.cn/#/Home) | 1589 | — |
| 45 | 全国大学生物理实验竞赛 | 已获取正文 | [全国大学生物理实验竞赛（创新）](https://wlsycx.moocollege.com/home/homepage) | 239 | — |
| 46 | 全国高校BIM毕业设计创新大赛 | 已获取正文 | [第13届国际高校BIM毕业设计大赛](https://gxbsxs.glodonedu.com/home#/home) | 850 | — |
| 47 | 全国高校商业精英挑战赛-①品牌策划竞赛、②文旅与会展创新创业实践竞赛、③国际贸易竞赛、④创新创业竞赛、⑤会计与商业管理案例竞赛 | 访问失败 | — | 0 | — |
| 48 | “学创杯”全国大学生创业综合模拟大赛 | 访问失败 | — | 0 | — |
| 49 | 中国高校智能机器人创意大赛 | 已获取正文 | [中国高校智能机器人创意大赛](https://www.robotcontest.cn/home/homepage) | 278 | — |
| 50 | 中国好创意暨全国数字艺术设计大赛 | 已获取正文 | [好创意大赛官网](https://www.cdec.org.cn/) | 3148 | — |
| 51 | 中国机器人及人工智能大赛 | 已获取正文 | [中国机器人及人工智能大赛官网](https://www.caairobot.com/) | 574 | 文字入口为2022年阿波罗虚拟仿真赛，二维码另列大赛入口。 |
| 52 | 全国大学生节能减排社会实践与科技竞赛 | 访问验证 | [可疑请求拦截通知](https://www.jienengjianpai.org/) | 33 | — |
| 53 | “21世纪杯”全国英语演讲比赛 | 正文不足 | [“21世纪杯”全国英语演讲官方网站](https://contest.i21st.cn/) | 12 | — |
| 54 | iCAN大学生创新创业大赛 | 已获取正文 | [iCAN](https://www.g-ican.com/home/index) | 1078 | — |
| 55 | “工行杯”全国大学生金融科技创新大赛 | 已获取正文 | [大赛介绍-“工行杯”全国大学生金融科技创新大赛](https://www.gonghangbei.com/index/Lists/index.html?id=1) | 1490 | — |
| 56 | 中华经典诵写讲大赛 | 访问失败 | — | 0 | — |
| 57 | “外教社杯”全国高校学生跨文化能力大赛 | 二维码未能识别 | — | 0 | — |
| 58 | 百度之星·程序设计大赛 | 已获取正文 | [百度之星大赛](https://star.baidu.com/#/) | 1345 | — |
| 59 | 全国大学生工业设计大赛 | 已获取正文 | [全国大学生工业设计大赛](https://www.cuidc.net/#/) | 718 | — |
| 60 | 全国大学生水利创新设计大赛 | 已获取正文 | [中国水利教育协会高等教育分会](https://sljzw.hhu.edu.cn/fenhui/main.psp) | 835 | 二维码为水利教育协会高等教育分会官网，当前水利创新设计赛通知尚待定位。 |
| 61 | 全国大学生化工实验大赛 | 访问失败 | — | 0 | — |
| 62 | 全国大学生化学实验创新设计大赛 | 已获取正文 | [全国大学生化学实验创新设计竞赛网](https://cid.nju.edu.cn/) | 52780 | 原官网正文包含大量历史章程，不能将历史章程直接视为当前规则。 |
| 63 | 全国大学生计算机系统能力大赛 | 已获取正文 | [全国大学生计算机系统能力大赛](https://compiler.educg.net/#/) | 711 | — |
| 64 | 全国大学生花园设计建造竞赛 | 访问失败 | — | 0 | 二维码给出另一网站入口，本轮访问失败，未取得花园设计建造竞赛通知。 |
| 65 | 全国大学生物联网设计竞赛 | 已获取正文 | [2022全国大学生物联网设计竞赛(华为杯)_高校_物联网_物联网竞赛_华为云](https://developer.huaweicloud.com/college/wulianwang.html) | 1884 | 文字入口明确标注2022年物联网竞赛，二维码另列入口。 |
| 66 | 全国大学生信息安全与对抗技术竞赛 | 已获取正文 | [信息系统及安全对抗实验中心（ISCC） \| Information System and Security & Countermeatures Experimental Center](https://www.isclab.org.cn/) | 2207 | — |
| 67 | 全国大学生测绘学科创新创业智能大赛 | 已获取正文 | [教育部高等学校测绘类专业教学指导委员会](https://smt.whu.edu.cn/index.htm) | 1471 | 机构首页包含教师教学赛事，需区分大学生赛与教师赛。 |
| 68 | 全国大学生统计建模大赛 | 访问失败 | — | 0 | — |
| 69 | 全国大学生能源经济学术创意大赛 | 访问失败 | — | 0 | 二维码指向第70项基础医学比赛，存在明显错配；未作为本比赛入口访问。 |
| 70 | 全国大学生基础医学创新研究暨实验设计论坛（大赛） | 访问失败 | — | 0 | — |
| 71 | 全国大学生数字媒体科技作品及创意竞赛 | 访问失败 | — | 0 | — |
| 72 | 全国本科院校税收风险管控案例大赛 | 已获取正文 | [全国本科院校税收风险管控案例大赛](https://ssfkds.moocollege.com/home/homepage) | 836 | — |
| 73 | 全国企业竞争模拟大赛 | 已获取正文 | [iBizSim\|企业竞争模拟\|赛创新港](https://www.ibizsim.cn/) | 533 | 首页及示例公告为模拟系统介绍和服务器维护，未取得当届竞赛通知。 |
| 74 | 全国高等院校数智化企业经营沙盘大赛 | 已获取正文 | [新道科技-科技使能教育 服务教育事业](https://www.seentao.com/) | 1351 | 二维码为新道科技综合官网，当前沙盘大赛专用栏目尚待定位。 |
| 75 | 全国数字建筑创新应用大赛 | 访问失败 | — | 0 | — |
| 76 | 全球校园人工智能算法精英大赛 | 需登录 | [‎](https://id1.cloud.huawei.com/CAS/portal/loginAuth.html) | 0 | — |
| 77 | 国际大学生智能农业装备创新大赛 | 已获取正文 | [欢迎访问国际大学生智能农业装备创新大赛](https://uiaec.ujs.edu.cn/) | 564 | — |
| 78 | “科云杯”全国大学生财会职业能力大赛 | 访问失败 | — | 0 | — |
| 79 | 全国职业院校技能大赛 | 已获取正文 | [职业院校技能大赛官网](https://www.vcsc.org.cn/) | 596 | — |
| 80 | 全国大学生机器人大赛-RoboTac | 访问验证 | [可疑请求拦截通知](https://www.robotac.cn/) | 33 | — |
| 81 | 世界技能大赛 | 已获取正文 | [WorldSkills - Follow your passion, improve your economic prospects, make society better](https://worldskills.org/) | 4109 | 与第82项文字入口共享官网；二维码另指向世界技能组织国际官网。 |
| 82 | 世界技能大赛中国选拔赛 | 访问失败 | — | 0 | — |
| 83 | 一带一路暨金砖国家技能发展与技术创新大赛 | 访问失败 | — | 0 | — |
| 84 | 码蹄杯全国职业院校程序设计大赛 | 已获取正文 | [码蹄集](https://www.matiji.net/exam/contest/topic2026?id=68) | 5280 | — |

## 通知及详情样本

### 2. “挑战杯”全国大学生课外学术科技作品竞赛

- [挑战杯丨关于举办第十五届“挑战杯”建设银行中国大学生创业计划竞赛的通知](https://www.tiaozhanbei.net/article/15842/)：已获取正文，正文4458字符。
- [挑战杯丨关于举办第十五届“挑战杯”建设银行中国大学生创业计划竞赛的通知](https://www.tiaozhanbei.net/article/15842/)：已获取正文，正文4458字符。

### 3. “挑战杯”中国大学生创业计划大赛

- [挑战杯丨关于举办第十五届“挑战杯”建设银行中国大学生创业计划竞赛的通知](https://www.tiaozhanbei.net/article/15842/)：已获取正文，正文4458字符。

### 5. 全国大学生数学建模竞赛

- [2026年全国大学生数学建模竞赛赛题讲评与经验交流会通知](https://www.mcm.edu.cn/html_cn/node/74ca2bd675a8399782a41dffa15f0910.html)：已获取正文，正文2028字符。

### 8. 全国大学生机械创新设计大赛

- [关于公布“华中数控杯”第十一届全国大学生机械创新设计大赛决赛评审结果的通知](https://11umic.hust.edu.cn/info/1107/1101.htm)：已获取正文，正文969字符。

### 15. “外研社·国才杯”“理解当代中国”全国大学生外语能力大赛-①英语演讲、②英语辩论、③英语写作、④英语阅读

- [福建赛区丨关于举办2026“外研社·国才杯”“理解当代中国”全国大学生外语能力大赛英语组短视频竞赛的通知](https://ucc.fltrp.com/c/2026-08-14/542892.shtml)：已获取正文，正文250字符。

### 18. 全国大学生化工设计竞赛

- [线上报名 1970年01月01日-01月01日 2026年03月01日至 2026年04月13日](https://iche.zju.edu.cn/zc.html)：已获取正文，正文357字符。

### 22. 全国三维数字化创新设计大赛

- [关于举办“2026第19届全国三维数字化创新设计大赛数字化设计与制造大赛赣闽皖赛区选拔赛”的通知 21 2026-09](https://3dds.3ddl.net/index.php?ctl=Informationlist&met=newsdetails&id=744)：已获取正文，正文2350字符。

### 24. 中国大学生服务外包创新创业大赛

- [第十七届中国大学生服务外包创新创业大赛全国赛决赛获奖名单公告](https://www.fwwb.org.cn/news/show/661)：已获取正文，正文363字符。

### 25. 中国大学生计算机设计大赛

- [09-18 .2026 中国大学生计算机设计大赛二十周年征文通知](https://jsjds.blcu.edu.cn/info/1041/2944.htm)：已获取正文，正文990字符。

### 34. 未来设计师·全国高校数字艺术设计大赛

- [大赛通知｜2026第14届未来设计师大赛-资料下载](https://www.ncda.org.cn/news/2025/1209/708.html)：已获取正文，正文419字符。
- [大赛通知｜2026第14届未来设计师大赛-资料下载](https://www.ncda.org.cn/news/2025/1209/708.html)：已获取正文，正文419字符。

### 38. “中国软件杯”大学生软件设计大赛

- [第十五届“中国软件杯”大赛全国总决赛通知](https://www.cnsoftbei.com/content-1-1357-1.html)：已获取正文，正文2570字符。
- [第十五届“中国软件杯”大赛全国总决赛通知](https://www.cnsoftbei.com/content-1-1357-1.html)：已获取正文，正文2570字符。

### 39. 中美青年创客大赛

- [2026共创未来-中美青年创客大赛竞赛章程](https://chinaus-maker.cscse.edu.cn/chinaus-maker/attachDir/2026/05/2026052815315453361.pdf)：正文不足，正文0字符。

### 44. 全国大学生生命科学竞赛（CULSC）

- [🔥关于举办“第十二届全国大学生生命科学竞赛(科学探究类)”的通知](https://www.culsc.cn/#/EdunoticeDetail?id=646&type=4)：已获取正文，正文337字符。
- [关于举办“生命科学导论通识教育研讨会”的第一轮通知](https://culsc.cn/#/EdunoticeDetail?id=652&type=4)：已获取正文，正文329字符。

### 51. 中国机器人及人工智能大赛

- [关于第二十八届中国机器人及人工智能大赛全国决赛（合肥）的通知](https://www.caairobot.com/post/notification-finalhefei-craic2026/)：已获取正文，正文257字符。

### 58. 百度之星·程序设计大赛

- [2026年百度之星程序设计大赛第二场初赛 晋级、获奖名单公示 2026-09-30](https://star.baidu.com/#/news-info?tab=3&id=807608869C8B28E42BF022BFDDEAB401)：已获取正文，正文646字符。

### 60. 全国大学生水利创新设计大赛

- [关于2026年水利类专业教学成果奖获奖成果...](https://sljzw.hhu.edu.cn/fenhui/2026/0728/c12009a332165/page.htm)：已获取正文，正文125字符。

### 62. 全国大学生化学实验创新设计大赛

- [竞赛指导：第四届竞赛章程修订说明](https://cid.nju.edu.cn/redirectActionxwgl/detail/201)：已获取正文，正文561字符。
- [竞赛指导：第四届竞赛章程修订说明](https://cid.nju.edu.cn/redirectActionxwgl/detail/201)：已获取正文，正文561字符。

### 66. 全国大学生信息安全与对抗技术竞赛

- [2026年第23届信息安全与对抗技术竞赛 “智能安全赛”——赛项要求通知及报名入口](https://www.isclab.org.cn/2026/09/10/2026%e5%b9%b4%e7%ac%ac23%e5%b1%8a%e4%bf%a1%e6%81%af%e5%ae%89%e5%85%a8%e4%b8%8e%e5%af%b9%e6%8a%97%e6%8a%80%e6%9c%af%e7%ab%9e%e8%b5%9b-%e6%99%ba%e8%83%bd%e5%ae%89%e5%85%a8%e8%b5%9b/)：已获取正文，正文2657字符。
- [2026年第23届信息安全与对抗技术竞赛 “智能安全赛”——赛项要求通知及报名入口](https://www.isclab.org.cn/2026/09/10/2026%e5%b9%b4%e7%ac%ac23%e5%b1%8a%e4%bf%a1%e6%81%af%e5%ae%89%e5%85%a8%e4%b8%8e%e5%af%b9%e6%8a%97%e6%8a%80%e6%9c%af%e7%ab%9e%e8%b5%9b-%e6%99%ba%e8%83%bd%e5%ae%89%e5%85%a8%e8%b5%9b/)：已获取正文，正文2827字符。

### 67. 全国大学生测绘学科创新创业智能大赛

- [2026年全国高等学校测绘学科教学创新与育才能力大赛—教学创新大赛决赛顺利举行 07月31日](https://smt.whu.edu.cn/info/1008/7362.htm)：已获取正文，正文3165字符。
- [2026年全国高等学校测绘学科教学创新与育才能力大赛—教学创新大赛决赛顺利举行 07月31日](https://smt.whu.edu.cn/info/1008/7362.htm)：已获取正文，正文3165字符。

### 73. 全国企业竞争模拟大赛

- [2026年服务器维护重要公告](https://www.ibizsim.cn/main/news/276)：已获取正文，正文383字符。

### 77. 国际大学生智能农业装备创新大赛

- [关于举办第十二届国际大学生智能农业装备创新大赛的通知](https://uiaec.ujs.edu.cn/news_show.php?id=234)：已获取正文，正文5127字符。
- [关于举办第十二届国际大学生智能农业装备创新大赛的通知](https://uiaec.ujs.edu.cn/news_show.php?id=234)：已获取正文，正文5127字符。

### 84. 码蹄杯全国职业院校程序设计大赛

- [2026年码蹄杯 本科院校赛道 & 青少年挑战赛道提高组初赛（省赛）第一场 竞赛时间 ：03-22 14:00 ~ 03-22 17:00 主 办 方 ：全国高等学校计算机教育研究会 关注数 152185 赛制类型 ACM](https://www.matiji.net/exam/contest/contestdetail/343)：已获取正文，正文732字符。

## 未成功入口与原因

### 3. “挑战杯”中国大学生创业计划大赛

- [http://www.chuangqingchun.net/](http://www.chuangqingchun.net/)：访问失败。网站证书与域名不匹配。

### 4. ACM-ICPC国际大学生程序设计竞赛

- [https://acm.cumt.edu.cn/](https://acm.cumt.edu.cn/)：访问失败。浏览器未返回网页正文，具体网络原因未确认。

### 6. 全国大学生电子设计竞赛

- [http://www.nuedcchina.com/](http://www.nuedcchina.com/)：访问失败。网站证书与域名不匹配。
- [http://nuedc.xjtu.edu.cn/](http://nuedc.xjtu.edu.cn/)：访问失败。浏览器未返回网页正文，具体网络原因未确认。

### 7. 中国大学生医学技术技能大赛

- 原目录未提供网页入口。原文：主办单位：教育部。

### 8. 全国大学生机械创新设计大赛

- [http://umic.ckcest.cn/](http://umic.ckcest.cn/)：访问失败。浏览器未返回网页正文，具体网络原因未确认。

### 9. 全国大学生结构设计竞赛

- [http://www.structurecontest.com/](http://www.structurecontest.com/)：访问失败。网站证书与域名不匹配。

### 11. 全国大学生智能汽车竞赛

- [http://www.smartcarrace.com/](http://www.smartcarrace.com/)：访问失败。网站证书与域名不匹配。

### 13. 中国大学生工程实践与创新能力大赛

- [http://www.gcxl.edu.cn/new/index.html](http://www.gcxl.edu.cn/new/index.html)：访问失败。网站证书与域名不匹配。

### 14. 全国大学生物流设计大赛

- [http://www.clpp.org.cn/html/competition/](http://www.clpp.org.cn/html/competition/)：正文不足。实际返回内容见本地快照。

### 16. 两岸新锐设计竞赛·华灿奖

- [http://www.huacanjiang.com/home](http://www.huacanjiang.com/home)：访问失败。网站证书与域名不匹配。

### 17. 全国大学生创新创业训练计划年会展示

- [http://gjcxcy.bjtu.edu.cn/Index.aspx](http://gjcxcy.bjtu.edu.cn/Index.aspx)：访问失败。浏览器未返回网页正文，具体网络原因未确认。

### 19. 全国大学生机器人大赛(CURC)

- [http://www.cnrobocon.net/](http://www.cnrobocon.net/)：访问失败。网站证书与域名不匹配。
- [https://www.cnrobocon.net/](https://www.cnrobocon.net/)：访问失败。网站证书与域名不匹配。

### 20. 全国大学生市场调查与分析大赛

- [http://www.china-cssc.org/list-56-1.html](http://www.china-cssc.org/list-56-1.html)：访问失败。浏览器未返回网页正文，具体网络原因未确认。
- [http://www.china-cssc.org/list-57-1.html](http://www.china-cssc.org/list-57-1.html)：访问失败。浏览器未返回网页正文，具体网络原因未确认。

### 21. 全国大学生先进成图技术与产品信息建模创新大赛

- [http://www.chengtudasai.com/](http://www.chengtudasai.com/)：访问失败。浏览器未返回网页正文，具体网络原因未确认。
- [http://chengtudasai.com/](http://chengtudasai.com/)：访问失败。浏览器未返回网页正文，具体网络原因未确认。

### 26. 中国高校计算机大赛-①大数据挑战赛、②团体程序设计天梯赛、③移动应用创新赛、④网络技术挑战赛、⑤人工智能创意赛

- [http://www.c4best.cn/](http://www.c4best.cn/)：访问失败。网站证书与域名不匹配。

### 28. 米兰设计周--中国高校设计学科师生优秀作品展

- [http://www.dandad.cn/](http://www.dandad.cn/)：访问失败。浏览器未返回网页正文，具体网络原因未确认。

### 30. 全国大学生光电设计竞赛

- [http://gd.p.moocollege.com/](http://gd.p.moocollege.com/)：访问失败。网站证书与域名不匹配。

### 31. 全国大学生集成电路创新创业大赛

- [http://univ.ciciec.com/](http://univ.ciciec.com/)：访问验证。实际返回内容见本地快照。

### 32. 全国大学生金相技能大赛

- [http://www.cnzjjx.cn/](http://www.cnzjjx.cn/)：访问失败。网站证书与域名不匹配。

### 33. 全国大学生信息安全竞赛

- [http://www.ciscn.cn/](http://www.ciscn.cn/)：访问失败。浏览器未返回网页正文，具体网络原因未确认。

### 35. 全国周培源大学生力学竞赛

- [http://zpy.cstam.org.cn/](http://zpy.cstam.org.cn/)：访问失败。浏览器未返回网页正文，具体网络原因未确认。
- [http://zpy.cstam.org.cn/index.aspx](http://zpy.cstam.org.cn/index.aspx)：访问失败。浏览器未返回网页正文，具体网络原因未确认。

### 36. 中国大学生机械工程创新创意大赛

- [http://www.gczbds.org](http://www.gczbds.org)：访问失败。网站证书与域名不匹配。
- [http://meicc.cmes.org](http://meicc.cmes.org)：访问失败。网站证书与域名不匹配。

### 37. 中国机器人大赛暨RoboCup机器人世界杯中国赛

- [http://crc.drct-caa.org.cn/](http://crc.drct-caa.org.cn/)：访问失败。浏览器未返回网页正文，具体网络原因未确认。

### 39. 中美青年创客大赛

- [https://www.eol.cn/html/lx/maker/](https://www.eol.cn/html/lx/maker/)：异常页面。实际返回内容见本地快照。

### 41. “大唐杯”全国大学生新一代信息通信技术大赛

- [https://dtcup.dtxiaotangren.com](https://dtcup.dtxiaotangren.com)：访问失败。浏览器未返回网页正文，具体网络原因未确认。
- [https://dtcup.dtxiaotangren.com/HomePage](https://dtcup.dtxiaotangren.com/HomePage)：访问失败。浏览器未返回网页正文，具体网络原因未确认。

### 46. 全国高校BIM毕业设计创新大赛

- [http://gxbsxs.glodonedu.com/index](http://gxbsxs.glodonedu.com/index)：异常页面。实际返回内容见本地快照。

### 47. 全国高校商业精英挑战赛-①品牌策划竞赛、②文旅与会展创新创业实践竞赛、③国际贸易竞赛、④创新创业竞赛、⑤会计与商业管理案例竞赛

- [http://cubec.org.cn/](http://cubec.org.cn/)：访问失败。网站证书与域名不匹配。

### 48. “学创杯”全国大学生创业综合模拟大赛

- [http://www.bster.cn/cyds/index](http://www.bster.cn/cyds/index)：访问失败。浏览器未返回网页正文，具体网络原因未确认。
- [http://www.xcbds.cn/cyds/index](http://www.xcbds.cn/cyds/index)：访问失败。浏览器未返回网页正文，具体网络原因未确认。

### 52. 全国大学生节能减排社会实践与科技竞赛

- [http://www.jienengjianpai.org/](http://www.jienengjianpai.org/)：访问验证。实际返回内容见本地快照。

### 53. “21世纪杯”全国英语演讲比赛

- [https://contest.i21st.cn/](https://contest.i21st.cn/)：正文不足。实际返回内容见本地快照。

### 56. 中华经典诵写讲大赛

- [https://www.jingdiansxj.cn/home](https://www.jingdiansxj.cn/home)：访问失败。浏览器未返回网页正文，具体网络原因未确认。

### 57. “外教社杯”全国高校学生跨文化能力大赛

- 二维码未能识别。原文：主办单位：上海外国语大学。

### 61. 全国大学生化工实验大赛

- [http://www.cteic.com/higherEducation-199.html?www.kulayu.com](http://www.cteic.com/higherEducation-199.html?www.kulayu.com)：访问失败。网站证书与域名不匹配。
- [http://www.cteic.com/higherEducation-199.html](http://www.cteic.com/higherEducation-199.html)：访问失败。网站证书与域名不匹配。

### 64. 全国大学生花园设计建造竞赛

- [http://www.lalavision.com/](http://www.lalavision.com/)：访问失败。网站证书与域名不匹配。

### 65. 全国大学生物联网设计竞赛

- [https://iot.sjtu.edu.cn/Default.aspx](https://iot.sjtu.edu.cn/Default.aspx)：访问失败。网站证书过期或时间无效。

### 68. 全国大学生统计建模大赛

- [http://tjjmds.ai-learning.net/](http://tjjmds.ai-learning.net/)：访问失败。浏览器未返回网页正文，具体网络原因未确认。

### 69. 全国大学生能源经济学术创意大赛

- [http://energy.ckcest.cn/eneco/contribution/index.html#/index](http://energy.ckcest.cn/eneco/contribution/index.html#/index)：访问失败。浏览器未返回网页正文，具体网络原因未确认。

### 70. 全国大学生基础医学创新研究暨实验设计论坛（大赛）

- [http://www.jcyxds.com/](http://www.jcyxds.com/)：访问失败。网站证书与域名不匹配。

### 71. 全国大学生数字媒体科技作品及创意竞赛

- [http://mit.caai.cn/](http://mit.caai.cn/)：访问失败。浏览器未返回网页正文，具体网络原因未确认。

### 74. 全国高等院校数智化企业经营沙盘大赛

- [http://spbk.seentao.com](http://spbk.seentao.com)：访问失败。浏览器未返回网页正文，具体网络原因未确认。

### 75. 全国数字建筑创新应用大赛

- [http://bisai.ccen.com.cn](http://bisai.ccen.com.cn)：访问失败。浏览器未返回网页正文，具体网络原因未确认。
- [http://bisai.ccen.com.cn/index](http://bisai.ccen.com.cn/index)：访问失败。浏览器未返回网页正文，具体网络原因未确认。

### 76. 全球校园人工智能算法精英大赛

- [https://developer.huawei.com/consumer/cn/activity/digixActivity/digixdetail/101655281685926449?ha_source=HR&ha_sourceId=8900](https://developer.huawei.com/consumer/cn/activity/digixActivity/digixdetail/101655281685926449?ha_source=HR&ha_sourceId=8900)：需登录。实际返回内容见本地快照。
- [https://www.digix.org.cn](https://www.digix.org.cn)：访问失败。浏览器未返回网页正文，具体网络原因未确认。

### 78. “科云杯”全国大学生财会职业能力大赛

- [http://match.xmkeyun.com.cn/](http://match.xmkeyun.com.cn/)：访问失败。浏览器未返回网页正文，具体网络原因未确认。
- [http://match.xmkeyun.com.cn/nc/](http://match.xmkeyun.com.cn/nc/)：访问失败。浏览器未返回网页正文，具体网络原因未确认。

### 79. 全国职业院校技能大赛

- [https://chinaskills.icve.com.cn](https://chinaskills.icve.com.cn)：访问失败。浏览器未返回网页正文，具体网络原因未确认。

### 80. 全国大学生机器人大赛-RoboTac

- [http://www.robotac.cn](http://www.robotac.cn)：访问验证。实际返回内容见本地快照。
- [https://www.robotac.cn/](https://www.robotac.cn/)：访问验证。实际返回内容见本地快照。

### 81. 世界技能大赛

- [http://worldskillschina.mohrss.gov.cn/](http://worldskillschina.mohrss.gov.cn/)：访问失败。浏览器未返回网页正文，具体网络原因未确认。

### 82. 世界技能大赛中国选拔赛

- [http://worldskillschina.mohrss.gov.cn/](http://worldskillschina.mohrss.gov.cn/)：访问失败。浏览器未返回网页正文，具体网络原因未确认。

### 83. 一带一路暨金砖国家技能发展与技术创新大赛

- [https://www.brskills.com](https://www.brskills.com)：访问失败。浏览器未返回网页正文，具体网络原因未确认。
- [http://www.brskills.com/#/index](http://www.brskills.com/#/index)：访问失败。浏览器未返回网页正文，具体网络原因未确认。
