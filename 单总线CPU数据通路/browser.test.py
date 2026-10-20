"""浏览器回归。用 with_server.py 启动静态服务后运行；也覆盖 file://。
可设 CPU_BASE_URL（默认 http://127.0.0.1:8017），CPU_GSAP_PATH 可选本地CDN缓存。
"""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent
URL = os.environ.get('CPU_BASE_URL', 'http://127.0.0.1:8017') + '/' + ROOT.name + '/index.html'


def seek(page, t):
    page.locator('#progress').evaluate('(el,t)=>{el.value=t;el.dispatchEvent(new Event("input",{bubbles:true}));}', t)


def value(page, name):
    return page.locator(f'#node-{name} .node-value').text_content()


def current_time(page):
    return float(page.locator('#progress').input_value())


def load(context, url=URL, block=False):
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    if block:
        page.route('**/gsap.min.js', lambda route: route.abort())
    elif os.environ.get('CPU_GSAP_PATH'):
        page.route('**/gsap.min.js', lambda route: route.fulfill(path=os.environ['CPU_GSAP_PATH'], content_type='application/javascript'))
    page.goto(url, wait_until='networkidle')
    return page, errors


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path='/opt/google/chrome/chrome', args=['--no-sandbox'])
    context = browser.new_context(viewport={'width': 1440, 'height': 1100})
    page, errors = load(context)
    assert page.evaluate('!!window.gsap'), 'CDN不可用；可用CPU_GSAP_PATH进行离线测试，另测真实CDN'
    assert value(page, 'MAR') == '0x0000'
    assert value(page, 'ACC') == '21'
    assert page.locator('#btn-step-prev').is_disabled()
    page.screenshot(path='/tmp/cpu-desktop.png', full_page=True)
    # 默认慢速：前1.4秒还没锁存；同一动作暂停后位置与数值冻结，续播不重来。
    page.locator('#btn-play-pause').click()
    page.wait_for_timeout(1300)
    page.locator('#btn-play-pause').click()
    paused = current_time(page)
    assert .8 < paused < 2.5 and value(page, 'MAR') == '0x0000'
    token = page.locator('#data-packet').get_attribute('transform')
    page.wait_for_timeout(250)
    assert current_time(page) == paused
    assert page.locator('#data-packet').get_attribute('transform') == token
    page.locator('#btn-play-pause').click()
    page.wait_for_timeout(300)
    page.locator('#btn-play-pause').click()
    assert current_time(page) > paused
    # 改变速度作用于当前动作，时间不跳，速率比约1.5。
    seek(page, 1)
    page.locator('#speed-select').select_option('1.5')
    page.locator('#btn-play-pause').click()
    page.wait_for_timeout(500)
    page.locator('#btn-play-pause').click()
    assert 1.4 < current_time(page) < 2.3
    seek(page, 3.3)
    assert value(page, 'MAR') == '0x0800'
    # 计算前仍显示原ACC，结果只在ALU计算后产生，Z先变、ACC后变。
    seek(page, 42)
    assert value(page, 'ACC') == '21' and value(page, 'Z') == '0'
    assert page.locator('#packet-value').text_content() == '21'
    page.screenshot(path='/tmp/cpu-data-in-flight.png', full_page=True)
    seek(page, 51.3)
    assert value(page, 'Z') == '63' and value(page, 'ACC') == '21'
    seek(page, 56)
    assert value(page, 'ACC') == '63'
    assert page.locator('#completion').is_visible()
    assert page.locator('#btn-step-next').is_disabled()
    page.screenshot(path='/tmp/cpu-complete.png', full_page=True)
    # 四种寻址；参数改变保留时刻，但取新序列长度的上界。
    for mode, total in [('ADD_REG',44), ('ADD_IMM',44), ('ADD_INDIRECT',56), ('ADD_MEM',56)]:
        keep = current_time(page)
        page.locator('#instruction-select').select_option(mode)
        assert current_time(page) == min(keep,total)
        seek(page,total)
        assert value(page,'ACC') == '63'
        seek(page,0)
    page.locator('#input-op-a').fill('0xFFFFFFFF')
    page.locator('#input-op-b').fill('1')
    seek(page,56)
    assert value(page,'ACC') == '0'
    assert page.locator('#flags').text_content() == 'Z=1  C=1  S=0  V=0'
    page.locator('#input-op-b').fill('12oops')
    assert page.locator('#input-error').is_visible()
    assert value(page,'ACC') == '0'
    page.locator('#input-op-a').fill('21')
    page.locator('#input-op-b').fill('65536')
    page.locator('#instruction-select').select_option('ADD_IMM')
    assert page.locator('#input-error').is_visible()
    assert page.locator('#instruction-select').input_value() == 'ADD_MEM'
    page.locator('#input-op-b').fill('42')
    page.locator('#btn-reset').click()
    assert current_time(page) == 0
    # 单步完整动画停在精确边界，再播放继续。
    page.locator('#btn-step-next').click()
    page.wait_for_function('Number(document.querySelector("#progress").value)===4 && document.querySelector("#play-text").textContent==="播放"', timeout=7000)
    assert page.locator('#play-text').text_content() == '播放'
    assert value(page,'MAR') == '0x0800'
    page.locator('#btn-play-pause').click()
    page.wait_for_timeout(150)
    page.locator('#btn-play-pause').click()
    assert current_time(page) > 4
    # 键盘不会抢文本框，Home复位；后台可见性事件暂停。
    page.locator('#input-op-a').focus()
    before = current_time(page)
    page.keyboard.press('Home')
    assert current_time(page) == before
    page.locator('body').click(position={'x': 4, 'y': 4})
    page.keyboard.press('Home')
    assert current_time(page) == 0
    page.keyboard.press('Space')
    page.wait_for_timeout(150)
    page.evaluate('Object.defineProperty(document,"hidden",{value:true,configurable:true});document.dispatchEvent(new Event("visibilitychange"))')
    assert page.locator('#play-text').text_content() == '播放'
    # 减少动效；选中线路与本步信号仍清晰，且没有飞行数据包。
    page.locator('#reduced-motion').check()
    seek(page,5.2)
    assert current_time(page) == 8
    assert page.locator('#data-packet').get_attribute('visibility') == 'hidden'
    assert float(page.locator('#transfer-readout').evaluate('(el)=>getComputedStyle(el).opacity')) == 1
    # 响应式局部滚动，不溢出整页。
    page.set_viewport_size({'width':390,'height':844})
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    assert page.locator('.diagram-scroll').evaluate('(el)=>el.scrollWidth>el.clientWidth')
    page.screenshot(path='/tmp/cpu-narrow.png', full_page=True)
    assert not errors, errors
    # 无引擎：初始化、单步、拖动、复位均可用。
    static, static_errors = load(context, URL + '#t=5.2', block=True)
    assert current_time(static) == 8
    static.locator('#btn-reset').click()
    assert static.locator('#engine-notice').is_visible()
    assert static.locator('#btn-play-pause').is_disabled()
    static.locator('#btn-step-next').click()
    assert current_time(static) == 4 and value(static,'MAR') == '0x0800'
    seek(static,56)
    assert value(static,'ACC') == '63'
    static.locator('#btn-reset').click()
    assert value(static,'ACC') == '21'
    assert not static_errors, static_errors
    # file协议（引擎可达时）与静态服务都能运行。
    local, local_errors = load(context, ROOT.joinpath('index.html').as_uri())
    seek(local,56)
    assert value(local,'ACC') == '63'
    assert not local_errors, local_errors
    # 默认跟随系统减少动态效果。
    reduced_context = browser.new_context(reduced_motion='reduce')
    rp, re = load(reduced_context, URL + '#t=5.2&mode=ADD_IMM&b=65536')
    assert rp.locator('#reduced-motion').is_checked()
    assert current_time(rp) == 8
    assert rp.locator('#input-op-b').input_value() == '42'
    rp.locator('#btn-reset').click()
    rp.locator('#btn-step-next').click()
    assert current_time(rp) == 4
    assert not re, re
    browser.close()
    print('PASS: HTTP/file、真实CDN、播放暂停续播、变速、单步、四种寻址、输入/FLAGS、键盘、后台暂停、减少动效、无引擎、窄屏')
