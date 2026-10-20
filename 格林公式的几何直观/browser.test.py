"""临时本地静态服务启动后运行；也验证直接打开文件。截图保存在 /tmp/green-qa。"""
from pathlib import Path
from urllib.parse import quote
from playwright.sync_api import sync_playwright
import json

BASE = 'http://127.0.0.1:8017/' + quote('格林公式的几何直观') + '/index.html'
OUT = Path('/tmp/green-qa')
OUT.mkdir(exist_ok=True)

def locate(page, t, n=3):
    page.evaluate('([t,n])=>location.hash=`n=${n}&t=${t}`', [t,n])
    page.wait_for_function('(t)=>Math.abs(parseFloat(document.querySelector("#time").textContent)-t)<.06', arg=t)

def opacity(page, selector):
    return page.locator(selector).evaluate('(e)=>e.getAttribute("opacity")')

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width':1440,'height':1060})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(BASE); page.wait_for_load_state('networkidle')
    assert page.evaluate('!!window.gsap'), '正常联网验证需成功加载GSAP'
    assert page.locator('#play').inner_text() == '播放'
    assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
    page.screenshot(path=str(OUT/'start.png'),full_page=True)
    for time, label in [(10.9,'two-cells'),(14.9,'first-cancel'),(26.0,'one-pair'),(39,'boundary'),(49.4,'formula')]:
        locate(page,time)
        page.screenshot(path=str(OUT/f'{label}.png'),full_page=True)
    # 从结束倒回同一时刻，精确重绘同一SVG，边界没有历史遗留。
    locate(page,26); before=page.locator('#geometry').inner_html()
    locate(page,49.4);locate(page,0);locate(page,26)
    assert page.locator('#geometry').inner_html()==before
    # 真实播放、暂停与倍速作用在当前进度。
    locate(page,5)
    page.locator('#play').click();page.wait_for_timeout(400)
    page.locator('#play').click(); paused=float(page.locator('#time').inner_text().split()[0])
    assert paused>5
    page.wait_for_timeout(200)
    assert float(page.locator('#time').inner_text().split()[0])==paused
    page.locator('#speed').select_option('2')
    page.locator('#play').click();page.wait_for_timeout(450);page.locator('#play').click()
    assert float(page.locator('#time').inner_text().split()[0])>=paused+.6
    # 改参数保留秒数，暂停。精细分块总环流仍为6。
    locate(page,15)
    page.locator('#density').select_option('6')
    assert page.locator('#time').inner_text()=='15.0 s'
    assert page.locator('#play').inner_text()=='播放'
    assert '24 格' in page.locator('#local-value').inner_text()
    assert '38 对' in page.locator('#count').inner_text()
    locate(page,0,9)
    assert '54 格' in page.locator('#local-value').inner_text()
    assert '93 对' in page.locator('#count').inner_text()
    page.screenshot(path=str(OUT/'dense.png'),full_page=True)
    # 高密度网格只慢放10对，余下2.4秒快速扫过并准确收尾。
    locate(page,46,9)
    assert '11 / 93' in page.locator('#count').inner_text()
    locate(page,47.2,9)
    assert '快速抵消' in page.locator('#note').inner_text()
    done=int(page.locator('#count').inner_text().split('/')[0])
    assert 11<done<93
    locate(page,48.4,9)
    assert '93 / 93' in page.locator('#count').inner_text()
    # 进度条、阶段、键盘（并保留表单原本的按键）。
    page.locator('#timeline').fill('10000')
    assert page.locator('#next').is_disabled()
    assert '93 / 93' in page.locator('#count').inner_text()
    page.locator('#steps button').nth(2).click()
    assert page.locator('#steps button').nth(2).get_attribute('aria-current')=='step'
    page.locator('h1').click();page.keyboard.press('Home')
    assert page.locator('#time').inner_text()=='0.0 s'
    page.keyboard.press('ArrowRight')
    assert float(page.locator('#time').inner_text().split()[0])>0
    locate(page,15,3)
    page.locator('#speed').focus();page.keyboard.press('ArrowLeft')
    assert page.locator('#time').inner_text()=='15.0 s'
    # 减少动态效果：起点只消去第1对，每次下一步增加一对。
    locate(page,17,3)
    page.locator('#reduce-motion').check()
    assert opacity(page,'#explanation > g:nth-of-type(1)')=='1'
    locate(page,22,3)
    assert page.locator('#play').is_disabled()
    assert '1 / 7' in page.locator('#count').inner_text()
    for expected in range(2,8):
        page.locator('#next').click()
        assert f'{expected} / 7' in page.locator('#count').inner_text()
    page.screenshot(path=str(OUT/'reduced.png'),full_page=True)
    page.locator('#reduce-motion').uncheck()
    # 窄窗口只允许舞台内部滚动，整页不溢出。
    page.set_viewport_size({'width':390,'height':900})
    assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
    assert page.locator('.stage-scroll').evaluate('(e)=>e.scrollWidth>e.clientWidth')
    page.screenshot(path=str(OUT/'narrow.png'),full_page=True)
    # 缺引擎：单步、参数、拖动、公式仍可用。
    offline=browser.new_page(viewport={'width':1280,'height':1000})
    offline.on('pageerror',lambda e:errors.append(str(e)))
    offline.route('**/gsap.min.js',lambda r:r.abort())
    offline.goto(BASE);offline.wait_for_load_state('networkidle')
    assert offline.locator('#play').is_disabled()
    assert '引擎未加载' in offline.locator('#notice').inner_text()
    offline.locator('#timeline').fill('10000')
    assert '7 / 7' in offline.locator('#count').inner_text()
    assert opacity(offline,'#explanation > g:nth-of-type(4)')=='1'
    offline.locator('#prev').click()
    assert float(offline.locator('#time').inner_text().split()[0])<49.4
    # file://直接打开，不依赖服务器；GSAP阻断时仍可手动浏览。
    filepage=browser.new_page(viewport={'width':1280,'height':1000})
    filepage.on('pageerror',lambda e:errors.append(str(e)))
    filepage.route('**/gsap.min.js',lambda r:r.abort())
    filepage.goto(Path(__file__).with_name('index.html').resolve().as_uri());filepage.wait_for_load_state('networkidle')
    filepage.locator('#timeline').fill('10000')
    assert '7 / 7' in filepage.locator('#count').inner_text()
    filepage.screenshot(path=str(OUT/'file-fallback.png'),full_page=True)
    # 系统偏好能在初次加载时启用。
    reduced_page=browser.new_page(reduced_motion='reduce')
    reduced_page.goto(BASE);reduced_page.wait_for_load_state('networkidle')
    assert reduced_page.locator('#reduce-motion').is_checked()
    assert reduced_page.locator('#play').is_disabled()
    assert not errors, errors
    print(json.dumps({'result':'PASS','checks':['静态服务','播放暂停倍速','回退确定重绘','三档网格','进度阶段键盘','减少动效逐对检查','窄屏局部滚动','缺引擎','file://','系统减少动效','无页面错误'],'screenshots':str(OUT)},ensure_ascii=False))
    browser.close()
