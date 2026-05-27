"""Map a transaction to a category by keyword matching against counterparty + product + tx_type."""

CATEGORY_KEYWORDS: list[tuple[str, list[str]]] = [
    ("餐饮", ["美团", "饿了么", "肯德基", "麦当劳", "星巴克", "瑞幸", "海底捞", "喜茶",
              "奈雪", "外卖", "餐厅", "食堂", "咖啡", "茶饮", "烘焙", "面包", "蛋糕",
              "火锅", "烧烤", "酒馆", "酒吧", "饭店", "小吃"]),
    ("交通", ["滴滴", "高德打车", "12306", "铁路", "地铁", "公交", "出行", "停车",
              "ETC", "加油", "中石化", "中石油", "曹操", "T3", "享道", "首汽",
              "航空", "机票", "携程", "去哪儿"]),
    ("购物", ["淘宝", "天猫", "京东", "拼多多", "唯品会", "苏宁", "国美", "小米有品",
              "得物", "抖音商城", "快手小店", "网易严选", "考拉", "亚马逊", "便利店",
              "超市", "全家", "罗森", "711", "7-11"]),
    ("生活缴费", ["电费", "水费", "燃气", "话费", "宽带", "物业", "房租", "水电",
                  "中国移动", "中国联通", "中国电信"]),
    ("娱乐", ["爱奇艺", "腾讯视频", "优酷", "B站", "哔哩哔哩", "网易云音乐", "QQ音乐",
              "Spotify", "Steam", "epic", "影院", "电影", "KTV", "演唱会", "票务",
              "大麦", "猫眼", "桌游", "剧本杀"]),
    ("医疗", ["医院", "药房", "药店", "诊所", "挂号", "体检", "牙科", "眼科"]),
    ("教育", ["学费", "培训", "课程", "网课", "得到", "极客时间", "知乎", "图书",
              "当当", "新华书店", "kindle"]),
    ("转账", ["转账", "红包", "亲属卡", "群收款", "AA收款", "微信红包"]),
    ("理财", ["理财通", "基金", "余额宝", "零钱通"]),
]

INCOME_KEYWORDS = ["工资", "薪资", "退款", "返现", "提现"]


def categorize(counterparty: str, product: str, tx_type: str, direction: str) -> str:
    text = f"{counterparty or ''} {product or ''} {tx_type or ''}"
    if direction == "income":
        for kw in INCOME_KEYWORDS:
            if kw in text:
                return "收入"
        return "收入"
    for cat, kws in CATEGORY_KEYWORDS:
        for kw in kws:
            if kw.lower() in text.lower():
                return cat
    return "其他"


ALL_CATEGORIES = [c for c, _ in CATEGORY_KEYWORDS] + ["收入", "其他"]

CATEGORY_COLORS = {
    "餐饮": "#FF6B6B",
    "交通": "#4ECDC4",
    "购物": "#FFD93D",
    "生活缴费": "#95E1D3",
    "娱乐": "#C77DFF",
    "医疗": "#FF8FAB",
    "教育": "#6BCB77",
    "转账": "#A0A0A0",
    "理财": "#F4A261",
    "收入": "#06D6A0",
    "其他": "#B0B0B0",
}
