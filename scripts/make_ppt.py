# -*- coding: utf-8 -*-
from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE
import os

# 颜色定义
LIGHT_BLUE = RGBColor(0xB8, 0xD4, 0xE8)
LIGHT_BLUE_BG = RGBColor(0xE8, 0xF0, 0xF8)
TENDER_YELLOW = RGBColor(0xF5, 0xE6, 0xA3)
TENDER_YELLOW_DEEP = RGBColor(0xE8, 0xD4, 0x7A)
DARK_GRAY = RGBColor(0x33, 0x33, 0x33)
MID_GRAY = RGBColor(0x55, 0x55, 0x55)
LIGHT_GRAY = RGBColor(0x99, 0x99, 0x99)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)

prs = Presentation()
# 9:16 竖版 10.8cm x 19.2cm
prs.slide_width = Emu(3810000)   # 10.8cm
prs.slide_height = Emu(6772800)  # 19.2cm

SLIDE_W = prs.slide_width
SLIDE_H = prs.slide_height

blank_layout = prs.slide_layouts[6]

def add_rect(slide, left, top, width, height, fill_color, line_color=None):
    shape = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, left, top, width, height)
    shape.fill.solid()
    shape.fill.fore_color.rgb = fill_color
    if line_color:
        shape.line.color.rgb = line_color
    else:
        shape.line.fill.background()
    return shape

def add_rounded_rect(slide, left, top, width, height, fill_color):
    shape = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, left, top, width, height)
    shape.fill.solid()
    shape.fill.fore_color.rgb = fill_color
    shape.line.fill.background()
    return shape

def add_oval(slide, left, top, width, height, fill_color):
    shape = slide.shapes.add_shape(MSO_SHAPE.OVAL, left, top, width, height)
    shape.fill.solid()
    shape.fill.fore_color.rgb = fill_color
    shape.line.fill.background()
    return shape

def add_text(slide, left, top, width, height, text, font_size, font_color, bold=False, alignment=PP_ALIGN.LEFT, font_name='微软雅黑'):
    txBox = slide.shapes.add_textbox(left, top, width, height)
    tf = txBox.text_frame
    tf.word_wrap = True
    p = tf.paragraphs[0]
    p.text = text
    p.font.size = Pt(font_size)
    p.font.color.rgb = font_color
    p.font.bold = bold
    p.font.name = font_name
    p.alignment = alignment
    return txBox

def add_multiline(slide, left, top, width, height, lines, font_size, font_color, bold=False, line_spacing=1.8, font_name='微软雅黑', alignment=PP_ALIGN.LEFT):
    txBox = slide.shapes.add_textbox(left, top, width, height)
    tf = txBox.text_frame
    tf.word_wrap = True
    for i, line in enumerate(lines):
        if i == 0:
            p = tf.paragraphs[0]
        else:
            p = tf.add_paragraph()
        p.text = line
        p.font.size = Pt(font_size)
        p.font.color.rgb = font_color
        p.font.bold = bold
        p.font.name = font_name
        p.alignment = alignment
        p.space_after = Pt(font_size * (line_spacing - 1))
    return txBox

# ========== 第1页 P1 ==========
slide1 = prs.slides.add_slide(blank_layout)

# 白色背景
add_rect(slide1, 0, 0, SLIDE_W, SLIDE_H, WHITE)

# 顶部浅蓝色块 (上方40%)
top_block = add_rect(slide1, 0, 0, SLIDE_W, Emu(2709120), LIGHT_BLUE)

# 标题
add_multiline(slide1, Emu(400000), Emu(600000), Emu(3010000), Emu(1200000),
    ['辛辛苦苦写半天', '电脑一卡全没了'],
    32, DARK_GRAY, bold=True, line_spacing=1.5, alignment=PP_ALIGN.CENTER)

# 中间插图区 - 简约电脑图标
icon_top = Emu(2900000)
# 电脑屏幕
screen = add_rect(slide1, Emu(1100000), icon_top, Emu(1610000), Emu(1000000), WHITE, line_color=LIGHT_BLUE)
# 屏幕上的红色闪电（用文字代替）
add_text(slide1, Emu(1400000), Emu(3050000), Emu(1000000), Emu(700000), '⚡', 48, RGBColor(0xE7, 0x4C, 0x3C), bold=True, alignment=PP_ALIGN.CENTER)
# 电脑底座
add_rect(slide1, Emu(900000), Emu(3900000), Emu(2010000), Emu(100000), LIGHT_BLUE)

# 黄色叹号
add_oval(slide1, Emu(2700000), Emu(3000000), Emu(600000), Emu(600000), TENDER_YELLOW)
add_text(slide1, Emu(2700000), Emu(3050000), Emu(600000), Emu(500000), '!', 24, DARK_GRAY, bold=True, alignment=PP_ALIGN.CENTER)

# 下方要点
add_multiline(slide1, Emu(500000), Emu(4500000), Emu(2810000), Emu(1500000),
    ['•  标书写到一半，电脑死机/闪退',
     '•  没来得及保存，心里一凉',
     '•  别慌：Word有自动恢复功能'],
    16, MID_GRAY, line_spacing=2.0)

# 底部装饰
add_rect(slide1, Emu(400000), Emu(6200000), Emu(3010000), Emu(30000), TENDER_YELLOW)
add_text(slide1, Emu(400000), Emu(6250000), Emu(3010000), Emu(300000), '标书急救指南  1/4', 11, LIGHT_GRAY, alignment=PP_ALIGN.CENTER)

# ========== 第2页 P2 ==========
slide2 = prs.slides.add_slide(blank_layout)
add_rect(slide2, 0, 0, SLIDE_W, SLIDE_H, WHITE)

# 顶部嫩黄色标签
tag = add_rounded_rect(slide2, Emu(1400000), Emu(200000), Emu(1000000), Emu(450000), TENDER_YELLOW)
add_text(slide2, Emu(1400000), Emu(230000), Emu(1000000), Emu(400000), '方法 1', 16, DARK_GRAY, bold=True, alignment=PP_ALIGN.CENTER)

# 标题区浅蓝色块
add_rect(slide2, 0, Emu(750000), SLIDE_W, Emu(1200000), LIGHT_BLUE)
add_multiline(slide2, Emu(400000), Emu(850000), Emu(3010000), Emu(1000000),
    ['重启Word', '自动弹出恢复文件'],
    28, DARK_GRAY, bold=True, line_spacing=1.5, alignment=PP_ALIGN.CENTER)

# 中间插图 - Word文档恢复
add_rect(slide2, Emu(800000), Emu(2150000), Emu(2210000), Emu(1400000), WHITE, line_color=LIGHT_BLUE)
# 左侧恢复列表
add_rect(slide2, Emu(800000), Emu(2150000), Emu(700000), Emu(1400000), LIGHT_BLUE_BG)
add_multiline(slide2, Emu(830000), Emu(2250000), Emu(650000), Emu(1200000),
    ['已恢复', '  文件1', '  文件2', '  文件3'],
    10, MID_GRAY, line_spacing=1.8)

# 步骤区
y_step = Emu(3750000)
steps2 = [
    ('1', '重新打开Word', '左侧会出现"已恢复"文件列表'),
    ('2', '点开找到你的文档', '确认内容是否完整'),
    ('3', '立即另存为', '保存为新的.docx文件'),
]
for i, (num, title, desc) in enumerate(steps2):
    y = Emu(3750000 + i * 700000)
    # 数字圆圈
    add_oval(slide2, Emu(500000), y, Emu(400000), Emu(400000), LIGHT_BLUE)
    add_text(slide2, Emu(500000), y, Emu(400000), Emu(400000), num, 16, WHITE, bold=True, alignment=PP_ALIGN.CENTER)
    # 标题
    add_text(slide2, Emu(1050000), y, Emu(2300000), Emu(300000), title, 16, DARK_GRAY, bold=True)
    # 说明
    add_text(slide2, Emu(1050000), Emu(y.emu + 320000), Emu(2300000), Emu(300000), desc, 12, LIGHT_GRAY)

# 右下角成功率标签
add_rounded_rect(slide2, Emu(2100000), Emu(5950000), Emu(1300000), Emu(450000), TENDER_YELLOW)
add_text(slide2, Emu(2100000), Emu(5980000), Emu(1300000), Emu(400000), '成功率 80%', 14, DARK_GRAY, bold=True, alignment=PP_ALIGN.CENTER)

# 底部装饰
add_rect(slide2, Emu(400000), Emu(6500000), Emu(3010000), Emu(30000), LIGHT_BLUE)
add_text(slide2, Emu(400000), Emu(6550000), Emu(3010000), Emu(300000), '标书急救指南  2/4', 11, LIGHT_GRAY, alignment=PP_ALIGN.CENTER)

# ========== 第3页 P3 ==========
slide3 = prs.slides.add_slide(blank_layout)
add_rect(slide3, 0, 0, SLIDE_W, SLIDE_H, WHITE)

# 顶部标签
add_rounded_rect(slide3, Emu(1400000), Emu(200000), Emu(1000000), Emu(450000), TENDER_YELLOW)
add_text(slide3, Emu(1400000), Emu(230000), Emu(1000000), Emu(400000), '方法 2', 16, DARK_GRAY, bold=True, alignment=PP_ALIGN.CENTER)

# 标题区
add_rect(slide3, 0, Emu(750000), SLIDE_W, Emu(1200000), LIGHT_BLUE)
add_multiline(slide3, Emu(400000), Emu(850000), Emu(3010000), Emu(1000000),
    ['去文件夹里', '找.asd文件'],
    28, DARK_GRAY, bold=True, line_spacing=1.5, alignment=PP_ALIGN.CENTER)

# 中间插图 - 文件夹
add_rect(slide3, Emu(800000), Emu(2150000), Emu(2210000), Emu(100000), LIGHT_BLUE)  # 路径条
add_text(slide3, Emu(850000), Emu(2100000), Emu(2100000), Emu(300000), '📁 文件夹路径', 12, MID_GRAY, alignment=PP_ALIGN.LEFT)

# 文件夹窗口
add_rect(slide3, Emu(800000), Emu(2350000), Emu(2210000), Emu(1100000), WHITE, line_color=LIGHT_BLUE)
# 文件图标们
for i in range(3):
    add_rect(slide3, Emu(950000 + i * 650000), Emu(2550000), Emu(400000), Emu(500000), LIGHT_BLUE_BG)
    add_text(slide3, Emu(950000 + i * 650000), Emu(3050000), Emu(400000), Emu(300000), ['.doc', '.asd', '.tmp'][i], 9, MID_GRAY, alignment=PP_ALIGN.CENTER)
# 高亮.asd文件
add_rect(slide3, Emu(1600000), Emu(2550000), Emu(400000), Emu(500000), TENDER_YELLOW)
add_text(slide3, Emu(1600000), Emu(3050000), Emu(400000), Emu(300000), '.asd', 9, DARK_GRAY, bold=True, alignment=PP_ALIGN.CENTER)

# 放大镜
add_oval(slide3, Emu(2100000), Emu(2400000), Emu(500000), Emu(500000), RGBColor(0xFF, 0xFF, 0xFF))
add_text(slide3, Emu(2100000), Emu(2400000), Emu(500000), Emu(500000), '🔍', 20, MID_GRAY, alignment=PP_ALIGN.CENTER)

# 步骤说明
add_text(slide3, Emu(500000), Emu(3700000), Emu(2810000), Emu(400000), '如果没自动弹出，去这个路径找：', 14, MID_GRAY)

# 路径框
add_rect(slide3, Emu(500000), Emu(4100000), Emu(2810000), Emu(900000), LIGHT_BLUE_BG)
add_multiline(slide3, Emu(600000), Emu(4150000), Emu(2610000), Emu(800000),
    ['C:\\Users\\你的用户名\\', 'AppData\\Roaming\\Microsoft\\Word'],
    11, DARK_GRAY, font_name='Consolas', line_spacing=1.6)

# 操作步骤
steps3 = [
    ('①', '找后缀 .asd 的文件'),
    ('②', '双击打开'),
    ('③', '立即另存为 .docx'),
]
for i, (num, desc) in enumerate(steps3):
    y = Emu(5200000 + i * 450000)
    add_text(slide3, Emu(550000), y, Emu(400000), Emu(400000), num, 18, TENDER_YELLOW_DEEP, bold=True)
    add_text(slide3, Emu(1000000), Emu(y.emu + 30000), Emu(2400000), Emu(400000), desc, 15, MID_GRAY)

# 底部装饰
add_rect(slide3, Emu(400000), Emu(6500000), Emu(3010000), Emu(30000), LIGHT_BLUE)
add_text(slide3, Emu(400000), Emu(6550000), Emu(3010000), Emu(300000), '标书急救指南  3/4', 11, LIGHT_GRAY, alignment=PP_ALIGN.CENTER)

# ========== 第4页 P4 ==========
slide4 = prs.slides.add_slide(blank_layout)
add_rect(slide4, 0, 0, SLIDE_W, SLIDE_H, WHITE)

# 顶部标签
add_rounded_rect(slide4, Emu(1400000), Emu(200000), Emu(1000000), Emu(450000), TENDER_YELLOW)
add_text(slide4, Emu(1400000), Emu(230000), Emu(1000000), Emu(400000), '方法 3', 16, DARK_GRAY, bold=True, alignment=PP_ALIGN.CENTER)

# 标题区
add_rect(slide4, 0, Emu(750000), SLIDE_W, Emu(1200000), LIGHT_BLUE)
add_multiline(slide4, Emu(400000), Emu(850000), Emu(3010000), Emu(1000000),
    ['养成3个好习惯', '再也不用怕'],
    28, DARK_GRAY, bold=True, line_spacing=1.5, alignment=PP_ALIGN.CENTER)

# 中间三个圆形图标
icons = ['⚙', '⌨', '☁']
icon_colors = [LIGHT_BLUE, TENDER_YELLOW, LIGHT_BLUE]
for i, (icon, color) in enumerate(zip(icons, icon_colors)):
    x = Emu(700000 + i * 850000)
    add_oval(slide4, x, Emu(2150000), Emu(650000), Emu(650000), color)
    add_text(slide4, x, Emu(2200000), Emu(650000), Emu(600000), icon, 28, WHITE, bold=True, alignment=PP_ALIGN.CENTER)

# 三个习惯
habits = [
    ('①', '打开Word"自动保存"功能', '设置1分钟保存一次'),
    ('②', '随时按 Ctrl + S', '写一段按一下，养成肌肉记忆'),
    ('③', '重要文件云盘备份', '存一份到网盘，双保险'),
]
for i, (num, title, desc) in enumerate(habits):
    y = Emu(3050000 + i * 850000)
    # 数字
    add_oval(slide4, Emu(500000), y, Emu(400000), Emu(400000), TENDER_YELLOW)
    add_text(slide4, Emu(500000), y, Emu(400000), Emu(400000), num, 16, DARK_GRAY, bold=True, alignment=PP_ALIGN.CENTER)
    # 标题
    add_text(slide4, Emu(1050000), y, Emu(2300000), Emu(300000), title, 16, DARK_GRAY, bold=True)
    # 说明
    add_text(slide4, Emu(1050000), Emu(y.emu + 320000), Emu(2300000), Emu(300000), desc, 12, LIGHT_GRAY)

# 底部总结条
add_rect(slide4, 0, Emu(5750000), SLIDE_W, Emu(600000), TENDER_YELLOW)
add_text(slide4, 0, Emu(5850000), SLIDE_W, Emu(400000), '好习惯比恢复方法更管用', 18, DARK_GRAY, bold=True, alignment=PP_ALIGN.CENTER)

# 底部装饰
add_rect(slide4, Emu(400000), Emu(6500000), Emu(3010000), Emu(30000), LIGHT_BLUE)
add_text(slide4, Emu(400000), Emu(6550000), Emu(3010000), Emu(300000), '标书急救指南  4/4', 11, LIGHT_GRAY, alignment=PP_ALIGN.CENTER)

# 保存
output_path = os.path.join(os.getcwd(), '标书急救指南.pptx')
prs.save(output_path)
print(f'PPT已生成: {output_path}')
