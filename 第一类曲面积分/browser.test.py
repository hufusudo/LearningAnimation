"""运行前开启仓库静态服务；SURFACE_URL 可指定页面地址。截图保存在 /tmp。"""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = os.environ.get('SURFACE_URL', 'http://127.0.0.1:8765/第一类曲面积分/index.html')
OUT = Path('/tmp/first-surface-browser')
OUT.mkdir(exist_ok=True)


def seek(page, t):
    page.locator('#progress').evaluate('(el,t)=>{el.value=t;el.dispatchEvent(new Event("input",{bubbles:true}))}', t)
    page.wait_for_timeout(80)


def read_state(page):
    return page.evaluate('''() => ({
      title:document.querySelector('#micro-title').textContent,
      nums:document.querySelector('#patch-numbers').textContent,
      points:document.querySelector('#flying-patch').getAttribute('points'),
      fly:getComputedStyle(document.querySelector('#transfer-overlay')).visibility,
      badge:document.querySelector('#micro-badge').textContent,
      formula:document.querySelector('#micro-equation').dataset.formula,
      t:document.querySelector('#progress').value
    })''')


def no_overflow(page):
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), '整页横向溢出'


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    page = browser.new_page(viewport={'width': 1440, 'height': 1100}, device_scale_factor=1)
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(BASE + '#t=3', wait_until='networkidle')
    assert page.locator('canvas').count() == 2
    assert page.locator('#scene-error').is_hidden()
    assert page.locator('#play').is_enabled()
    assert page.locator('.katex').count() > 0

    # 转移中只有飞行切片接管；重复跳转、倒退重绘一致。
    seek(page, 3.435)
    state = read_state(page)
    assert state['fly'] == 'visible'
    pts = [list(map(float, x.split(','))) for x in state['points'].split()]
    assert max(x for x, y in pts) > min(x for x, y in pts) + 30
    page.screenshot(path=str(OUT / 'transfer.png'), full_page=True)
    seek(page, 8)
    seek(page, 3.435)
    again = read_state(page)
    assert state == again, (state, again)
    page.wait_for_timeout(200)
    assert read_state(page) == state, '暂停时飞行切片仍在移动'

    seek(page, 4)
    assert read_state(page)['fly'] == 'hidden'
    assert page.locator('#micro-empty').is_hidden()
    assert '同一块 #43' in read_state(page)['badge']
    assert '0.5000' in page.locator('#zoom-note').inner_text()
    seek(page, 5)
    assert '切平面' in read_state(page)['title'] or '平面' in read_state(page)['title']
    assert '曲面面积' in read_state(page)['nums'] and '切平面面积' in read_state(page)['nums']
    seek(page, 7)
    assert page.locator('#section-strip').bounding_box()['height'] == 145
    triangle = page.locator('#section-triangle').get_attribute('d')
    assert '-' not in triangle, triangle
    page.screenshot(path=str(OUT / 'projection.png'), full_page=True)
    seek(page, 8)
    page.locator('#normal-detail summary').click()
    assert page.locator('#normal-detail').get_attribute('open') is not None
    assert page.locator('#normal-formula .katex').count() == 1
    page.screenshot(path=str(OUT / 'factor.png'), full_page=True)
    page.locator('#normal-detail summary').click()

    # 换片、细分、密度变化保留当前时刻，物理范围跟着所选格子改变。
    page.locator('#change-patch').click()
    assert read_state(page)['badge'] != '同一块 #43'
    assert float(read_state(page)['t']) == 8
    page.locator('#n-slider').evaluate('(el)=>{el.value=4;el.dispatchEvent(new Event("input",{bubbles:true}))}')
    assert '0.2500' in page.locator('#zoom-note').inner_text()
    assert float(read_state(page)['t']) == 8
    page.locator('[data-rho="uniform"]').click()
    assert page.locator('#meter-area').inner_text() == page.locator('#meter-mass').inner_text()
    page.locator('[data-rho="gradient"]').click()
    assert float(page.locator('#meter-mass').inner_text()) > float(page.locator('#meter-area').inner_text())

    # 播放/暂停/继续使用同一时间，速度变化应用在当前动作。
    seek(page, 3.2)
    page.locator('#play').click()
    page.wait_for_timeout(220)
    page.locator('#play').click()
    paused = read_state(page)
    page.wait_for_timeout(220)
    assert read_state(page) == paused
    page.locator('#speed').select_option('2')
    page.locator('#play').click()
    page.wait_for_timeout(180)
    page.locator('#play').click()
    assert float(read_state(page)['t']) > float(paused['t'])
    # 单步的移动过程也可暂停，并有准确的按钮名称。
    seek(page, 3)
    page.locator('#next').click()
    page.wait_for_timeout(100)
    assert page.locator('#play').get_attribute('aria-label') == '暂停演示'
    page.locator('#play').click()
    paused = read_state(page)
    page.wait_for_timeout(150)
    assert read_state(page) == paused
    page.locator('#reduce-motion').check()
    page.locator('#next').click()
    assert float(read_state(page)['t']).is_integer()
    page.locator('#next').click()
    assert float(read_state(page)['t']).is_integer()
    page.locator('#scene').focus()
    page.keyboard.press('Home')
    assert float(read_state(page)['t']) == 0
    page.keyboard.press('ArrowRight')
    assert float(read_state(page)['t']) == 1
    page.keyboard.press('ArrowLeft')
    assert float(read_state(page)['t']) == 0

    # 全步骤、桌面/窄宽、file://；没有整页横向溢出。
    for size in [{'width': 1440, 'height': 1100}, {'width': 390, 'height': 844}]:
        page.set_viewport_size(size)
        for step in range(12):
            seek(page, step)
            no_overflow(page)
        page.screenshot(path=str(OUT / f'width-{size["width"]}.png'), full_page=True)
    for n_index in [0, 12]:
        page.locator('#n-slider').evaluate('(el,v)=>{el.value=v;el.dispatchEvent(new Event("input",{bubbles:true}))}', n_index)
        no_overflow(page)
        seek(page, 3.435)
        assert read_state(page)['fly'] == 'visible'
        seek(page, 7)
        assert '切平面面积' in read_state(page)['nums']
    page.locator('#n-slider').evaluate('(el)=>{el.value=4;el.dispatchEvent(new Event("input",{bubbles:true}))}')
    page.set_viewport_size({'width': 1440, 'height': 1100})
    seek(page, 7)
    saved_url = page.url
    expected = read_state(page)['nums']
    page.reload(wait_until='networkidle')
    assert read_state(page)['nums'] == expected and page.url == saved_url
    page.goto(Path(__file__).resolve().with_name('index.html').as_uri() + '#t=7', wait_until='networkidle')
    assert page.locator('canvas').count() == 2
    assert page.locator('#scene-error').is_hidden()
    assert read_state(page)['title'] == '同样的宽，长度缩短了'
    no_overflow(page)
    assert not errors, errors

    # 资源缺失的功能降级分别检查，网络拦截为预期失败。
    for resource, expected_notice in [('gsap', '动画资源未加载'), ('three', '三维资源未加载'), ('katex', None)]:
        fallback = browser.new_page(viewport={'width': 1280, 'height': 1000})
        fallback_errors = []
        fallback.on('pageerror', lambda e: fallback_errors.append(str(e)))
        fallback.route('**/*', lambda route, request, resource=resource: route.abort() if resource in route.request.url.lower() and route.request.resource_type in ['script', 'stylesheet'] else route.continue_())
        fallback.goto(BASE + '#t=4', wait_until='networkidle')
        if resource == 'gsap':
            assert fallback.locator('#play').is_disabled()
            assert expected_notice in fallback.locator('#engine-notice').inner_text()
            fallback.locator('#next').click()
            assert float(read_state(fallback)['t']) == 5
        elif resource == 'three':
            assert expected_notice in fallback.locator('#scene-error').inner_text()
        else:
            assert fallback.locator('#micro-equation .katex').count() == 0
            assert 'ΔSᵢ' in fallback.locator('#micro-equation').inner_text()
        seek(fallback, 11)
        assert '取极限' in fallback.locator('#micro-title').inner_text()
        no_overflow(fallback)
        assert not fallback_errors, fallback_errors
        fallback.close()
    system_reduced = browser.new_page(reduced_motion='reduce')
    system_reduced.goto(BASE, wait_until='networkidle')
    assert system_reduced.locator('#reduce-motion').is_checked()
    system_reduced.locator('#next').click()
    assert float(read_state(system_reduced)['t']) == 1
    system_reduced.close()
    print(json.dumps({'result': 'passed', 'page_errors': errors, 'screenshots': str(OUT), 'checks': ['transfer/rewind/pause', 'local-geometry/numerics', 'controls/keyboard/speed', 'all-steps/desktop/narrow', 'hash/file/http', 'GSAP/Three/KaTeX-fallback', 'reduced-motion']}, ensure_ascii=False))
    browser.close()
