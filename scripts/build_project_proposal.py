from pathlib import Path

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor


OUT = Path(__file__).resolve().parents[1] / "outputs" / "季度往来对账管理系统立项说明书.docx"

NAVY = "102247"
BLUE = "1267F4"
MUTED = "61708A"
LINE = "DCE5F1"
FILL = "F4F8FE"
LIGHT_BLUE = "EAF3FF"
ORANGE = "FF7A1A"
RED = "D92D20"
GREEN = "168A55"


def set_run(run, size=10.5, bold=False, color=NAVY):
    run.font.name = "Microsoft YaHei"
    run._element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft YaHei")
    run.font.size = Pt(size)
    run.bold = bold
    run.font.color.rgb = RGBColor.from_string(color)


def set_cell_shading(cell, fill):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = tc_pr.find(qn("w:shd"))
    if shd is None:
        shd = OxmlElement("w:shd")
        tc_pr.append(shd)
    shd.set(qn("w:fill"), fill)


def set_cell_border(cell, **kwargs):
    tc = cell._tc
    tc_pr = tc.get_or_add_tcPr()
    tc_borders = tc_pr.first_child_found_in("w:tcBorders")
    if tc_borders is None:
        tc_borders = OxmlElement("w:tcBorders")
        tc_pr.append(tc_borders)
    for edge in ("top", "left", "bottom", "right"):
        if edge in kwargs:
            edge_data = kwargs.get(edge)
            tag = "w:{}".format(edge)
            element = tc_borders.find(qn(tag))
            if element is None:
                element = OxmlElement(tag)
                tc_borders.append(element)
            for key in ["val", "sz", "space", "color"]:
                if key in edge_data:
                    element.set(qn("w:{}".format(key)), str(edge_data[key]))


def set_cell_width(cell, width_cm):
    cell.width = Cm(width_cm)
    tc_pr = cell._tc.get_or_add_tcPr()
    tc_w = tc_pr.find(qn("w:tcW"))
    if tc_w is None:
        tc_w = OxmlElement("w:tcW")
        tc_pr.append(tc_w)
    tc_w.set(qn("w:w"), str(int(width_cm / 2.54 * 1440)))
    tc_w.set(qn("w:type"), "dxa")


def add_text(cell, text, bold=False, size=9.5, color=NAVY):
    p = cell.paragraphs[0]
    p.paragraph_format.space_after = Pt(0)
    p.paragraph_format.space_before = Pt(0)
    p.paragraph_format.line_spacing = 1.15
    r = p.add_run(text)
    set_run(r, size=size, bold=bold, color=color)


def add_heading(doc, text, level=1):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(15 if level == 1 else 10)
    p.paragraph_format.space_after = Pt(6)
    p.paragraph_format.keep_with_next = True
    run = p.add_run(text)
    set_run(run, size=16 if level == 1 else 12.5, bold=True, color=BLUE if level == 1 else NAVY)
    if level == 1:
        p_pr = p._p.get_or_add_pPr()
        p_bdr = OxmlElement("w:pBdr")
        bottom = OxmlElement("w:bottom")
        bottom.set(qn("w:val"), "single")
        bottom.set(qn("w:sz"), "8")
        bottom.set(qn("w:space"), "5")
        bottom.set(qn("w:color"), BLUE)
        p_bdr.append(bottom)
        p_pr.append(p_bdr)
    return p


def add_body(doc, text, bold_prefix=None):
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(5)
    p.paragraph_format.line_spacing = 1.18
    if bold_prefix and text.startswith(bold_prefix):
        r1 = p.add_run(bold_prefix)
        set_run(r1, size=10.5, bold=True)
        r2 = p.add_run(text[len(bold_prefix):])
        set_run(r2, size=10.5)
    else:
        set_run(p.add_run(text), size=10.5)
    return p


def add_bullet(doc, text, level=0):
    p = doc.add_paragraph(style="List Bullet")
    p.paragraph_format.left_indent = Cm(0.65 + level * 0.45)
    p.paragraph_format.first_line_indent = Cm(-0.35)
    p.paragraph_format.space_after = Pt(3)
    p.paragraph_format.line_spacing = 1.15
    set_run(p.add_run(text), size=10.2)
    return p


def add_table(doc, headers, rows, widths, font_size=9.1):
    table = doc.add_table(rows=1, cols=len(headers))
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    table.style = "Table Grid"
    hdr = table.rows[0]
    for idx, text in enumerate(headers):
        cell = hdr.cells[idx]
        set_cell_width(cell, widths[idx])
        set_cell_shading(cell, "E8EEF8")
        set_cell_border(cell, top={"val":"single", "sz":"6", "color":LINE}, bottom={"val":"single", "sz":"6", "color":LINE}, left={"val":"single", "sz":"6", "color":LINE}, right={"val":"single", "sz":"6", "color":LINE})
        cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
        add_text(cell, text, bold=True, size=font_size, color="263B5D")
    for row_idx, row in enumerate(rows):
        cells = table.add_row().cells
        for idx, text in enumerate(row):
            cell = cells[idx]
            set_cell_width(cell, widths[idx])
            if row_idx % 2 == 1:
                set_cell_shading(cell, "FAFCFF")
            set_cell_border(cell, top={"val":"single", "sz":"4", "color":"E3EAF3"}, bottom={"val":"single", "sz":"4", "color":"E3EAF3"}, left={"val":"single", "sz":"4", "color":"E3EAF3"}, right={"val":"single", "sz":"4", "color":"E3EAF3"})
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
            add_text(cell, text, size=font_size)
    doc.add_paragraph().paragraph_format.space_after = Pt(1)
    return table


def add_callout(doc, title, body, color=BLUE):
    table = doc.add_table(rows=1, cols=1)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    cell = table.cell(0, 0)
    set_cell_width(cell, 16.8)
    set_cell_shading(cell, "F4F8FE")
    set_cell_border(cell, top={"val":"single", "sz":"8", "color":color}, bottom={"val":"single", "sz":"8", "color":color}, left={"val":"single", "sz":"8", "color":color}, right={"val":"single", "sz":"8", "color":color})
    p = cell.paragraphs[0]
    p.paragraph_format.space_after = Pt(2)
    set_run(p.add_run(title), size=10.5, bold=True, color=color)
    p2 = cell.add_paragraph()
    p2.paragraph_format.space_after = Pt(0)
    p2.paragraph_format.line_spacing = 1.15
    set_run(p2.add_run(body), size=10.2, color="334A6B")
    doc.add_paragraph().paragraph_format.space_after = Pt(2)


def add_header_footer(section):
    header = section.header
    p = header.paragraphs[0]
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.paragraph_format.space_after = Pt(0)
    set_run(p.add_run("季度往来对账管理系统｜立项说明书"), size=8.5, color=MUTED)
    footer = section.footer
    p = footer.paragraphs[0]
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    set_run(p.add_run("内部项目资料｜2026年8月"), size=8.5, color=MUTED)


def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    doc = Document()
    section = doc.sections[0]
    section.page_width = Cm(21)
    section.page_height = Cm(29.7)
    section.top_margin = Cm(1.9)
    section.bottom_margin = Cm(1.7)
    section.left_margin = Cm(2.0)
    section.right_margin = Cm(2.0)
    section.header_distance = Cm(0.8)
    section.footer_distance = Cm(0.8)
    add_header_footer(section)

    normal = doc.styles["Normal"]
    normal.font.name = "Microsoft YaHei"
    normal._element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft YaHei")
    normal.font.size = Pt(10.5)
    normal.paragraph_format.space_after = Pt(5)
    normal.paragraph_format.line_spacing = 1.18

    # First-page memo masthead: named A4 / Chinese-font override of standard_business_brief.
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(16)
    p.paragraph_format.space_after = Pt(4)
    set_run(p.add_run("项目立项说明书"), size=12, bold=True, color=BLUE)
    title = doc.add_paragraph()
    title.paragraph_format.space_after = Pt(5)
    set_run(title.add_run("季度往来对账管理系统"), size=26, bold=True, color=NAVY)
    sub = doc.add_paragraph()
    sub.paragraph_format.space_after = Pt(16)
    set_run(sub.add_run("现状架构、业务范围、问题清单与建设建议"), size=13, color=MUTED)

    meta = add_table(doc, ["项目名称", "当前系统访问地址", "文档日期"], [["季度往来对账管理系统", "https://quarterly-recon-lenovo.poetic-macaw-6673.chatgpt.site", "2026-08-13"]], [3.5, 9.5, 3.8], font_size=9.2)
    doc.add_paragraph()
    add_callout(doc, "立项结论", "系统已形成“导入—对账—销售填写—发票核验—问题跟进—管理看板”的可操作原型，并已发布可访问版本。当前核心短板是数据主要保存在浏览器本地，尚未形成企业级的统一数据、权限、审计与稳定接口体系。建议将下一阶段立项定位为“原型产品化与数据治理建设”。", BLUE)

    add_heading(doc, "一、项目背景与建设目标")
    add_body(doc, "企业季度往来对账涉及多个账套、区域、客户及发票级差额处理。当前工作通常依赖 Excel 汇总、销售线下补充、财务人工核验与领导阶段性汇报，存在数据分散、处理过程不透明、历史问题难追溯、管理层难以及时定位风险等问题。")
    add_body(doc, "本项目拟建设一套面向财务、销售和管理层的季度往来对账管理系统，将季度对账数据、销售差额填写、资料收集、未解决问题跟进和管理决策看板纳入统一流程。")
    add_table(doc, ["建设目标", "说明"], [
        ["统一数据入口", "以季度对账明细、公司应收、往来明细和资料提供情况为基础，形成统一数据底座。"],
        ["提升对账效率", "通过批量导入、精确筛选、发票自动带出、OCR 识别与核验状态提示，减少重复录入。"],
        ["实现闭环管理", "将未解决客户从待解决清单持续跟进，处理完成后进入按季度归档的已解决档案。"],
        ["强化经营决策", "通过对账看板、问题解决看板和管理层驾驶舱，展示区域、客户、差额、账龄和风险优先级。"],
    ], [3.3, 13.5])

    add_heading(doc, "二、当前系统范围与使用对象")
    add_table(doc, ["角色", "当前主要职责", "系统使用重点"], [
        ["财务/管理员", "导入季度数据、公司应收及往来明细；复核数据；维护基础口径。", "本季度对账详细情况、数据导入、管理层驾驶舱。"],
        ["销售/区域负责人", "补充客户账面金额、差额说明、解决方案、死账和调账信息。", "销售填写抽屉、未解决客户跟进。"],
        ["对账管理人员", "识别未对清客户、推进跟进动作、处理超期和财务关注事项。", "问题解决看板、待解决清单、已解决档案。"],
        ["管理层", "查看整体对清率、风险客户、账龄、区域表现和专项风险。", "管理层驾驶舱、对账看板。"],
    ], [3.2, 6.8, 6.8])

    add_heading(doc, "三、现有功能架构")
    add_body(doc, "当前系统为单页 Web 应用，采用左侧导航承载多个业务视图；不同看板和执行页面共享季度对账数据、销售填写数据和未解决客户数据。")
    add_table(doc, ["功能域", "已实现能力", "主要输出"], [
        ["对账看板", "资料收集总览、有效回函率（按区域）、未对账客户重点清单、区域对清情况、未对清风险趋势。", "资料收集率、有效回函率、未对清客户及区域对清结果。"],
        ["本季度对账详细情况", "季度选择、Excel 导入、客户/账套/区域/金额精确筛选、橙色差额标识、销售填写入口。", "客户级对账明细与差额处理记录。"],
        ["销售填写", "二级销售填写大抽屉、六类差额汇总、三级差额明细抽屉、死账/调账/解决方案维护。", "发票级或无发票差额明细及解决信息。"],
        ["发票核验与OCR", "已维护发票号后自动带出开票日期与金额；五类有发票差额支持 OCR 发票号识别；展示往来核验正确/错误。", "发票号、日期、金额、差额说明、核验状态。"],
        ["未解决客户跟进", "待解决清单、已解决档案、跟进状态、财务关注、处理阶段、区域分布、导出。", "持续跟进清单、解决记录和闭环归档。"],
        ["问题解决看板", "问题指标、处理阶段、责任人 Top5、风险优先级 Top5、重点问题预览及下钻。", "问题总览、责任分布、待办与下钻入口。"],
        ["管理层驾驶舱", "应对账总额、对清率、未对清金额、差额账龄、区域表现、差额结构、高风险未解决客户 Top10。", "全局风险、区域表现和账龄风险。"],
    ], [3.0, 8.3, 5.5], font_size=8.7)

    add_heading(doc, "四、业务流程与数据流")
    add_body(doc, "核心业务链路如下：")
    add_table(doc, ["阶段", "输入/操作", "系统处理", "输出"], [
        ["1. 数据导入", "导入季度对账表、公司应收更新表、往来明细、资料提供情况。", "按中文表头归一化；公司应收按账套+区域+客户名称精准更新。", "季度基础明细、账套/区域/客户数据。"],
        ["2. 对账计算", "公司应收与客户账面金额。", "对账差额 = 公司应收 − 客户账面金额；识别未对清客户。", "对清状态、未对清金额、差额清单。"],
        ["3. 销售填写", "销售点击客户行“填写”，再按差额类型录入明细。", "六类差额汇总与明细联动；发票号命中往来明细后自动填充日期/金额。", "差额分类、差额说明、死账/调账、解决方案。"],
        ["4. 核验与跟进", "财务查看核验状态并推动问题。", "根据差额、解决时间等规则生成待解决或已解决档案。", "待解决清单、已解决档案、跟进状态。"],
        ["5. 管理分析", "按季度查看管理看板。", "聚合区域、客户、差额账龄和资料收集数据。", "风险提示、排行榜、区域表现、决策信息。"],
    ], [2.2, 4.5, 5.4, 4.7], font_size=8.7)
    add_callout(doc, "关键口径", "对账差额以“公司应收 − 客户账面金额”计算；未对清金额、未解决差额、区域表现和客户排行必须从同一季度、同一客户主数据及未解决清单口径派生，避免看板之间出现不一致。", ORANGE)

    add_heading(doc, "五、技术架构现状")
    add_table(doc, ["层级", "当前实现", "说明"], [
        ["前端", "React 19 + TypeScript + Next/Vinext", "以组件化页面承载对账明细、跟进、问题看板和管理驾驶舱。"],
        ["样式与图表", "CSS、ECharts、React Loading Skeleton", "用于企业财务风格的表格、指标卡、趋势图和分布图。"],
        ["文件处理", "XLSX", "在浏览器中解析 Excel 并执行字段映射、筛选和导出。"],
        ["OCR", "浏览器上传图片后直接调用 OCR 服务：192.168.51.116:8000/ocr/recognize", "用于五类“有发票”差额明细的发票号识别；再复用本地往来索引自动带出日期、金额。"],
        ["客户端存储", "localStorage 为主；部分数据索引使用浏览器端缓存机制", "季度表、销售填写、跟进状态和看板快照目前主要依赖当前浏览器。"],
        ["服务端基础", "Cloudflare Worker、D1/Drizzle Schema、R2 逻辑绑定", "已有数据库表和接口基础，但核心业务尚未完成统一服务端持久化。"],
        ["部署", "Cloudflare Sites", "系统已发布为可访问 Web 站点。"],
    ], [3.1, 5.1, 8.2], font_size=8.8)

    add_heading(doc, "六、当前数据模型与关键字段")
    add_table(doc, ["数据实体", "关键字段", "使用场景"], [
        ["季度对账明细", "季度、账套、区域、对账负责人、客户名称、公司应收、客户账面金额、对账差额、是否对清。", "本季度对账详细情况、对账看板、驾驶舱。"],
        ["差额明细", "差额分类、发票号、开票日期、金额、差额说明、附件（仅无发票类型）。", "销售填写、账龄分析、差额结构、OCR与发票核验。"],
        ["未解决客户", "客户、区域、负责人、未解决金额、最近跟进时间、处理阶段、财务关注、解决方案、解决时间。", "待解决清单、问题看板、已解决档案。"],
        ["往来明细/发票索引", "发票号、日期、金额、账套及历史/当期来源。", "自动填充与往来核验。"],
        ["资料收集", "资料类型、区域、已提供/未提供、有效回函状态。", "资料收集总览、有效回函率、重点跟进建议。"],
    ], [3.0, 8.1, 5.3], font_size=8.8)

    add_heading(doc, "七、当前已识别的问题与立项风险")
    add_table(doc, ["优先级", "问题/风险", "现状影响", "建议治理措施"], [
        ["P0", "核心数据以浏览器本地存储为主", "不同电脑、浏览器或清理缓存后可能看不到同一份数据；无法保证多人共享、备份和统一版本。", "将季度、客户、差额明细、跟进与档案迁移至 D1/业务数据库；形成服务端 API 和数据备份策略。"],
        ["P0", "权限与审计未形成生产级闭环", "当前系统存在登录/接口基础，但核心页面数据尚未全面接入角色、区域、账套、金额权限与操作审计。", "落实组织、用户、角色、数据权限模型；记录导入、修改、审核、导出和状态变更日志。"],
        ["P0", "OCR 服务为内网直连接口", "发布站点从用户浏览器调用内网地址，受网络可达性、CORS、认证与服务稳定性影响；不可作为无治理的生产依赖。", "明确 OCR 接口协议、鉴权、CORS 白名单、错误码、限流与监控；必要时通过企业网关/后端代理接入。"],
        ["P1", "导入数据依赖表头与主键质量", "中文表头变化、客户重名、账套/区域缺失会造成匹配失败或看板空白。", "建立导入模板、字段字典、数据校验报告和客户/账套唯一编码；导入前展示异常行。"],
        ["P1", "多看板指标存在重复计算风险", "对账看板、问题看板、驾驶舱若各自计算，易因筛选口径、未对账排除规则不同而产生数字不一致。", "建立统一指标服务/Selector，明确“未对账不计入分母”等口径并执行自动化对账校验。"],
        ["P1", "发票匹配与异常处理需要企业规则固化", "发票号、日期、金额的匹配依赖往来数据完整性；多日期、负数、重复发票等情况需有明确的人工复核策略。", "建立发票唯一键、匹配优先级、异常队列和人工复核工作台；保留原始证据与核验结果。"],
        ["P1", "附件与证据材料未纳入企业文件存储", "无发票差额附件目前以浏览器侧数据形式处理，容量、保留期、权限、检索和防泄露能力不足。", "使用 R2/企业对象存储；绑定记录、权限、生命周期和病毒扫描策略。"],
        ["P2", "大文件与大数据量性能待验证", "当前 Excel 解析、数据聚合和多表渲染主要由前端承担，大季度/多账套场景可能出现加载慢、浏览器卡顿。", "将大文件导入、清洗、索引和聚合迁移到后端异步任务；列表采用分页/虚拟滚动。"],
        ["P2", "测试与运维体系不足", "已有构建与页面功能迭代，但缺少覆盖关键口径、导入、权限、OCR、数据一致性的自动化回归与监控。", "补充单元测试、接口测试、端到端测试、异常告警、日志追踪和数据质量监控。"],
    ], [1.1, 4.1, 5.7, 5.5], font_size=8.2)

    add_heading(doc, "八、建议立项范围与建设分期")
    add_table(doc, ["阶段", "建议范围", "阶段成果"], [
        ["一期：数据产品化基础", "统一季度、客户、账套、发票、差额、跟进的数据模型；建设服务端 API、D1/R2 持久化、导入校验、数据备份。", "多用户可共享的季度对账数据底座；数据不再依赖单一浏览器。"],
        ["二期：流程与权限闭环", "接入组织与角色权限；销售填写、财务复核、问题升级、已解决归档、操作日志；完善发票匹配规则。", "可审计、可追责、可跨部门协同的处理闭环。"],
        ["三期：智能识别与管理提升", "OCR 服务治理、异常规则、自动催办、经营预警、统一指标服务和管理报表。", "稳定的智能录入与管理层实时决策能力。"],
    ], [3.0, 8.5, 4.9], font_size=8.8)
    add_body(doc, "立项建议优先解决 P0 事项：统一数据持久化、权限审计和 OCR 服务治理。页面与看板的持续优化应建立在上述基础之上，避免业务使用范围扩大后出现数据不一致或无法追溯的问题。")

    add_heading(doc, "九、项目验收建议")
    for item in [
        "季度、账套、区域、客户、发票与差额明细可在服务端统一保存，跨浏览器/跨用户可一致访问。",
        "公司应收导入只更新允许更新的字段；导入结果可追溯、可回滚、可查看异常行。",
        "销售填写、OCR识别、发票自动填充、往来核验和人工复核均留存操作记录。",
        "待解决清单、已解决档案、问题解决看板、管理层驾驶舱使用统一统计口径，关键指标可核对。",
        "用户只能访问授权区域、账套、客户及金额范围，导出和附件下载同样受控。",
        "关键流程具备异常提示、接口失败处理、数据备份、监控和自动化回归测试。",
    ]:
        add_bullet(doc, item)

    add_heading(doc, "十、立项所需决策与资源")
    add_table(doc, ["决策事项", "建议确认内容"], [
        ["数据主责部门", "明确季度对账表、公司应收、客户主数据、往来明细与资料收集数据的维护责任人与更新频率。"],
        ["主数据标准", "确定账套编码、客户唯一编码、区域编码、发票唯一键、差额分类和处理阶段枚举。"],
        ["权限边界", "明确财务、销售、区域负责人、管理层的查看、填写、审核、导出和附件权限。"],
        ["OCR服务标准", "确认接口请求/响应结构、网络路径、鉴权方式、CORS、最大文件、并发与异常处理责任。"],
        ["部署与运维", "确认生产数据库、对象存储、备份、日志、监控、容灾和发布审批流程。"],
    ], [4.0, 12.4], font_size=9.0)

    add_heading(doc, "附录A：当前系统入口")
    add_body(doc, "当前访问地址： https://quarterly-recon-lenovo.poetic-macaw-6673.chatgpt.site")
    add_body(doc, "当前已发布版本适合作为业务流程演示、字段确认和原型验收的基础。正式推广前，应以本说明书第七部分的 P0/P1 风险治理为前置条件。")

    doc.save(OUT)
    print(OUT)


if __name__ == "__main__":
    main()
