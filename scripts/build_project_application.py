from pathlib import Path

from docx import Document
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor


OUT = Path(__file__).resolve().parents[1] / "outputs" / "终端季度往来对账管理系统立项报告.docx"
BLUE = "1267F4"
NAVY = "102247"
MUTED = "66758F"
LINE = "DCE5F1"


def font(run, size=10.5, bold=False, color=NAVY):
    run.font.name = "Microsoft YaHei"
    run._element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft YaHei")
    run.font.size = Pt(size)
    run.bold = bold
    run.font.color.rgb = RGBColor.from_string(color)


def shade(cell, fill):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:fill"), fill)
    tc_pr.append(shd)


def border(cell, color=LINE, size="6"):
    tc_pr = cell._tc.get_or_add_tcPr()
    borders = OxmlElement("w:tcBorders")
    for edge in ("top", "left", "bottom", "right"):
        side = OxmlElement(f"w:{edge}")
        side.set(qn("w:val"), "single")
        side.set(qn("w:sz"), size)
        side.set(qn("w:color"), color)
        borders.append(side)
    tc_pr.append(borders)


def cell_width(cell, cm):
    cell.width = Cm(cm)
    tc_pr = cell._tc.get_or_add_tcPr()
    width = OxmlElement("w:tcW")
    width.set(qn("w:w"), str(round(cm / 2.54 * 1440)))
    width.set(qn("w:type"), "dxa")
    tc_pr.append(width)


def write_cell(cell, text, *, bold=False, size=9.5, color=NAVY):
    p = cell.paragraphs[0]
    p.paragraph_format.space_before = Pt(2)
    p.paragraph_format.space_after = Pt(2)
    p.paragraph_format.line_spacing = 1.12
    font(p.add_run(text), size, bold, color)
    cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER


def table(doc, headers, rows, widths, body_size=9.3):
    t = doc.add_table(rows=1, cols=len(headers))
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    t.autofit = False
    for i, label in enumerate(headers):
        c = t.rows[0].cells[i]
        cell_width(c, widths[i]); shade(c, "EAF3FF"); border(c)
        write_cell(c, label, bold=True, size=body_size, color="234267")
    for r_index, values in enumerate(rows):
        cells = t.add_row().cells
        for i, value in enumerate(values):
            c = cells[i]
            cell_width(c, widths[i]); border(c, size="4")
            if r_index % 2: shade(c, "FAFCFF")
            write_cell(c, value, size=body_size)
    p = doc.add_paragraph(); p.paragraph_format.space_after = Pt(0)
    return t


def body(doc, text, *, indent=False):
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(6)
    p.paragraph_format.line_spacing = 1.25
    if indent: p.paragraph_format.first_line_indent = Cm(0.74)
    font(p.add_run(text), 10.5)
    return p


def heading(doc, text):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(13)
    p.paragraph_format.space_after = Pt(7)
    p.paragraph_format.keep_with_next = True
    font(p.add_run(text), 14.5, True, BLUE)
    return p


def subheading(doc, text):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(8)
    p.paragraph_format.space_after = Pt(4)
    font(p.add_run(text), 11.2, True, NAVY)
    return p


def bullet(doc, text):
    p = doc.add_paragraph(style="List Bullet")
    p.paragraph_format.space_after = Pt(3)
    p.paragraph_format.line_spacing = 1.18
    font(p.add_run(text), 10.2)
    return p


def add_footer(section):
    p = section.footer.paragraphs[0]
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    font(p.add_run("终端季度往来对账管理系统立项报告"), 8.5, color=MUTED)


def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    doc = Document()
    section = doc.sections[0]
    section.page_width = Cm(21); section.page_height = Cm(29.7)
    section.top_margin = Cm(1.8); section.bottom_margin = Cm(1.7)
    section.left_margin = Cm(2.0); section.right_margin = Cm(2.0)
    section.header_distance = Cm(0.8); section.footer_distance = Cm(0.8)
    add_footer(section)

    normal = doc.styles["Normal"]
    normal.font.name = "Microsoft YaHei"
    normal._element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft YaHei")
    normal.font.size = Pt(10.5)

    # proposal_centerpiece: formal Chinese project proposal title stack.
    p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(28); p.paragraph_format.space_after = Pt(8)
    font(p.add_run("立 项 报 告"), 13, True, BLUE)
    p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_after = Pt(10)
    font(p.add_run("终端季度往来对账管理系统"), 26, True, NAVY)
    p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_after = Pt(22)
    font(p.add_run("项目立项申请与实施计划"), 13, False, MUTED)
    table(doc, ["项目负责人", "拟上线日期", "验收人", "项目奖金"], [["刘平平", "2026年9月30日", "刘强", "20,000元"]], [4.2, 4.8, 3.8, 4.0], 9.5)

    heading(doc, "一、项目概述")
    body(doc, "目前公司终端季度对账工作完全依赖线下 Excel 流转操作，区域销售手工填写金额、发票号、差额原因，总部复核人员逐条人工比对发票信息与往来台账，整体人力成本高、效率低下；对账差异客户缺少线上持续跟进联动机制，各类对账完成情况、风险问题、跟进责任人等报表均需人工整理制作，无可视化管理看板支撑经营决策。", indent=True)
    body(doc, "为彻底替代线下手工对账流程，实现对账全流程线上协同、数据自动校验、问题闭环跟踪、经营数据可视化展示，计划内部自主开发终端季度往来对账管理系统，分两期迭代建设；项目采用内部人员结合 AI 辅助快速开发、轻量化迭代模式落地。", indent=True)

    heading(doc, "二、项目目标")
    subheading(doc, "（一）一期目标")
    body(doc, "一期核心定位为“全面替代线下手工操作、搭建基础可视化看板”，解决当前核心业务痛点，优先保障业务落地、快速上线、便于后期迭代扩展。")
    for x in [
        "用户登录、基础账号角色权限基础框架；",
        "季度对账台账、应收、往来发票批量导入管理；",
        "区域销售线上差额填报模块，替代 Excel 手工填写；",
        "系统自动发票核验，自动比对发票号、金额与往来数据；",
        "未解决客户跟进看板，支持客户一键跳转完整处置明细；",
        "管理员综合看板：对账整体进度、发票异常清单、待跟进客户、资料收集汇总展示；",
        "对账数据多维度查询、筛选、导出；",
        "对账问题全流程记录归档，自动生成对账统计数据，无需手工制作报表。",
    ]: bullet(doc, x)
    subheading(doc, "（二）二期目标")
    body(doc, "一期稳定上线运行后，再根据实际使用需求逐步扩展：")
    for x in [
        "资料收集穿透查询，快速定位缺资料客户明细；",
        "有效回函率穿透展示，直达未提供有效回函客户及对应原因；",
        "系统消息推送机制，销售上传处置材料自动提醒管理员复核；",
        "线上处置闭环流程，复核通过自动归档至已解决客户档案；",
        "发票附件一键上传 + OCR 自动识别读取发票信息；",
        "对账解决方案录音留存功能；",
        "网页移动端适配，手机端可查看对账、填报信息；",
        "精细化分级账号、角色、数据权限管控；",
        "完善操作审计日志、附件存储生命周期管理。",
    ]: bullet(doc, x)

    heading(doc, "三、建设方案")
    body(doc, "项目采用轻量化、模块化的系统架构，优先使用成熟技术和现有基础设施，避免引入不必要的微服务及复杂中间件。")
    body(doc, "系统主要包括：")
    for x in [
        "对账 PC 网页管理端；", "后端业务服务；", "业务数据库；", "发票、附件、录音文件存储；",
        "台账导入解析服务；", "OCR 识别对接接口；", "消息通知模块；", "操作日志与定时数据备份。",
    ]: bullet(doc, x)
    subheading(doc, "核心业务流程")
    body(doc, "管理员导入对账 / 应收 / 往来台账 → 销售线上填报差额信息 → 系统自动校验发票数据 → 未结清客户进入跟进看板持续跟踪 → 管理员线上复核处置材料 → 复核完成归档已解决客户 → 全量数据聚合展示至管理看板。", indent=True)

    heading(doc, "四、项目实施计划")
    table(doc, ["阶段", "时间", "工作内容"], [
        ["需求整理与原型确认", "7月15日—7月20日", "梳理线下对账全流程，锁定一期功能开发范围，确认页面原型。"],
        ["系统开发", "7月21日—9月10日", "完成线上填报、自动发票核验、跟进看板、管理员驾驶舱、导入导出核心功能开发。"],
        ["联调及自测", "9月11日—9月20日", "前后端接口联调、对账数据逻辑校验、功能缺陷修复。"],
        ["测试试运行", "9月21日—9月28日", "业务全流程测试、销售与复核人员试用、收集反馈并整改问题。"],
        ["正式上线", "9月30日", "完成系统切换，一期全部功能正式投入使用。"],
    ], [3.8, 4.1, 9.0])
    subheading(doc, "关键里程碑")
    for x in [
        "2026年9月10日前完成一期全部开发；",
        "2026年9月21日至9月28日完成测试试运行；",
        "2026年9月30日完成一期正式上线。",
    ]: bullet(doc, x)

    heading(doc, "五、项目人员安排")
    body(doc, "本项目由开发组和业务部门共同完成。")
    table(doc, ["角色", "人员/部门", "职责"], [
        ["项目负责人", "刘平平", "统筹全项目进度、需求对接、验收协调。"],
        ["内部开发人员", "1名", "独立负责全流程需求梳理确认、系统整体架构与页面设计、前后端全功能代码开发、台账导入、发票校验、看板统计逻辑开发、内部自测、数据逻辑调试、系统部署上线及后续版本维护。"],
        ["业务部门", "相关业务部门", "提供线下完整对账流程、测试台账数据、日常业务痛点，并安排销售、复核实际使用人员参与测试验收。"],
    ], [3.0, 3.3, 10.6])

    heading(doc, "六、项目风险及控制")
    table(doc, ["风险事项", "风险说明", "控制措施"], [
        ["需求范围增加", "一期工期紧张。", "一期开发期间原则上不增加非必要功能；新增需求统一记录，放入二期实施。"],
        ["线下手工流程功能遗漏", "实际高频操作可能未被完整覆盖。", "开发前完整梳理现有 Excel 全流程、日常对账操作步骤，以实际高频在用功能为一期开发范围。"],
        ["台账数据导入匹配风险", "导入表字段、格式、存量历史数据存在差异。", "规范标准导入模板，增加导入前数据校验逻辑；导入异常行单独展示，支持人工修正后重新导入；原 Excel 台账临时留存备查。"],
        ["单人独立开发风险", "项目由一人开发，交付和知识沉淀压力集中。", "优先完成对账主流程，减少复杂定制设计，同时做好代码版本管理、定时数据库备份和系统部署运维文档。"],
        ["上线切换风险", "业务切换期间可能影响日常对账。", "试运行阶段线下 Excel 对账与新系统并行使用；上线前完成全量数据备份，准备快速回退方案。"],
    ], [3.4, 4.8, 8.7], 8.8)

    heading(doc, "七、验收标准")
    body(doc, "满足以下全部条件后，可认为一期项目完成：")
    for x in [
        "原有线下对账手工填报、人工发票复核工作可完全由系统替代，业务正常流转；",
        "台账导入、销售填报、自动发票校验、客户跟进、复核归档形成完整业务闭环；",
        "未解决客户看板支持一键穿透查看完整处置明细，问题持续联动跟踪；",
        "管理员看板正常展示对账进度、发票异常、待办客户、资料收集指标，自动统计无需手工制表；",
        "全链路对账数据计算准确，无重复、缺失、金额偏差问题；",
        "对账明细、处置记录、客户清单查询、筛选、导出功能正常可用；",
        "连续试运行15天，不存在阻碍日常对账工作的严重故障；",
        "业务使用人员、项目负责人刘平平确认系统可完全替代现有线下对账模式，并通过验收人刘强验收。",
    ]: bullet(doc, x)

    heading(doc, "八、预期效果")
    body(doc, "项目一期上线完成后，将实现：")
    for x in [
        "彻底摆脱线下 Excel 手工对账模式，大幅减少销售填报、总部发票复核人力投入；",
        "搭建线上客户问题跟踪体系，对账差异全程可追溯，解决跟进脱节、无持续联动问题；",
        "统一对账数据底座，多岗位共享标准化数据，消除分散 Excel 信息孤岛；",
        "自动生成多维度管理看板，实时展示对账风险、区域进度、异常发票，支撑管理层决策；",
        "省去人工整理对账报表工作，大幅提升对账整体工作效率；",
        "搭建稳定底层系统框架，为二期移动端、OCR 发票识别、消息推送、录音归档、精细化权限功能提供基础支撑。",
    ]: bullet(doc, x)
    body(doc, "二期全部功能落地后，将额外实现资料回函穿透查询、自动消息提醒、发票智能识别、语音存档、手机端访问、分级数据权限管控，完成对账全流程数字化闭环。", indent=True)

    heading(doc, "九、立项申请")
    body(doc, "本项目业务痛点清晰、一期功能边界明确、技术实现难度可控，现有功能可通过内部开发和 AI 辅助开发方式快速实现。", indent=True)
    body(doc, "建议批准“终端季度往来对账管理系统重构项目”立项，由项目负责人刘平平统筹推进，内部开发人员负责实施，一期于2026年9月10日前完成开发，经过8天业务试运行测试后，于2026年9月30日正式上线。", indent=True)
    body(doc, "一期上线后，根据实际业务使用情况，再确定二期扩展功能及实施计划。", indent=True)
    subheading(doc, "项目奖金申请")
    table(doc, ["项目", "金额", "说明"], [
        ["项目上线并通过刘强验收后奖励", "20,000元", "申请项目奖金。"],
        ["开发人员奖励", "15,000元", "用于奖励内部开发人员。"],
        ["业务部门参与测试验收人员奖励", "5,000元", "用于奖励参与测试验收的业务人员。"],
    ], [6.8, 3.8, 6.3])
    doc.add_paragraph()
    p = doc.add_paragraph(); p.paragraph_format.space_before = Pt(18)
    font(p.add_run("申请人：刘平平                                      日期：2026年    月    日"), 10.5, color=MUTED)

    doc.save(OUT)
    print(OUT)


if __name__ == "__main__":
    main()
