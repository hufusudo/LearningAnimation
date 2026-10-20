"""运行：python browser.test.py --base-url http://127.0.0.1:8000
需要 Python Playwright 与 Chromium；也可设置 CHROMIUM_PATH。
"""
import argparse
import os
from pathlib import Path
from urllib.parse import quote
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent
parser = argparse.ArgumentParser()
parser.add_argument('--base-url', default='http://127.0.0.1:8000')
args = parser.parse_args()
url = args.base_url.rstrip('/') + '/' + quote(ROOT.name) + '/index.html'
errors = []


def seek(page, value):
    page.locator('#progress-slider').evaluate('''(el, value) => {
        el.value = value; el.dispatchEvent(new Event('input', {bubbles: true}));
    }''', value)


def current(page):
    return page.locator('#progress-slider').input_value()


def view(page):
    return page.locator('#heap-svg').evaluate('''el => JSON.stringify([...el.querySelectorAll('*')].map(node => ({
      tag: node.tagName,
      attrs: [...node.attributes].map(a => [a.name, a.value]).sort((a, b) => a[0].localeCompare(b[0])),
      text: node.children.length ? null : node.textContent
    })))''')


def go(page, target):
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(target, wait_until='networkidle')
    page.wait_for_function('!!window.HeapModel && document.querySelectorAll(".cell").length === 7')


def sorted_values(page):
    return page.locator('.cell').evaluate_all('''els => els.map(el => ({
      x: el.transform.baseVal.getItem(0).matrix.e,
      value: Number(el.querySelector('.value').textContent)
    })).sort((a, b) => a.x - b.x).map(item => item.value)''')


with sync_playwright() as p:
    path = os.environ.get('CHROMIUM_PATH')
    browser = p.chromium.launch(headless=True, **({'executable_path': path} if path else {}))
    context = browser.new_context(viewport={'width': 1440, 'height': 1100}, reduced_motion='no-preference')
    page = context.new_page()
    go(page, url)
    assert page.evaluate('!!window.gsap'), '真实 CDN 动画引擎未加载，不能将降级当作播放测试通过'
    assert page.locator('#btn-play').is_enabled()
    assert page.locator('#hud-comp').inner_text() == '0'
    assert page.locator('.cell').count() == 7
    assert page.locator('.node[visibility="visible"]').count() == 0
    assert page.locator('#hud-locked').inner_text() == '0'
    assert page.locator('#sort-result').get_attribute('visibility') == 'hidden'
    assert page.locator('#btn-prev').is_disabled()
    page.screenshot(path='/tmp/heap-desktop.png', full_page=True)
    # 每一步只放入当前输入项，先完成层序树，不提前比较或排序。
    for i in range(1, 8):
        seek(page, i)
        assert page.locator('.node[visibility="visible"]').count() == i
        assert page.locator('#hud-comp').inner_text() == '0'
        assert page.locator('#hud-swap').inner_text() == '0'
        assert page.locator('#hud-locked').inner_text() == '0'
    page.locator('[data-seek="tree"]').click()
    assert page.locator('#action-title').inner_text() == '层序建树完成'
    assert sorted_values(page) == [49, 38, 65, 97, 76, 13, 27]
    assert page.locator('#process-0').get_attribute('aria-current') == 'step'
    page.screenshot(path='/tmp/heap-level-order.png', full_page=True)
    page.locator('#process-1').click()
    assert page.locator('#process-1').get_attribute('aria-current') == 'step'
    assert page.locator('#hud-comp').inner_text() == '0'
    page.locator('#process-2').click()
    assert page.locator('#action-title').inner_text() == '开始堆排序'
    assert page.locator('#process-2').get_attribute('aria-current') == 'step'
    assert page.locator('#hud-locked').inner_text() == '0'
    duration = int(page.locator('#progress-slider').get_attribute('max'))
    swap = page.evaluate('HeapModel.buildSequence(HeapModel.DEFAULT_VALUES).events.findIndex(e => e.kind === "swap")')
    built = page.evaluate('HeapModel.buildSequence(HeapModel.DEFAULT_VALUES).events.findIndex(e => e.kind === "buildDone") + 1')

    # 每一个事件中段都能直接访问；回退后任意时刻可精确复现。
    for t in [i + 0.48 for i in range(duration)]:
        seek(page, t)
        assert 'NaN' not in view(page)
    seek(page, swap + 0.45)
    before = view(page)
    assert page.locator('#mapping-lines path[visibility="visible"]').count() == 2
    page.screenshot(path='/tmp/heap-swap.png', full_page=True)
    # 每次下滤交换和堆顶交换，双方映射均跟随各自的树/数组坐标。
    exchanges = page.evaluate('''HeapModel.buildSequence(HeapModel.DEFAULT_VALUES).events
      .flatMap((event, i) => ['swap', 'exchange'].includes(event.kind) ? [i] : [])''')
    for event_index in exchanges:
        seek(page, event_index + 0.45)
        assert page.locator('#mapping-lines path[visibility="visible"]').count() == 2
        assert page.evaluate('''t => {
          const seq = HeapModel.buildSequence(HeapModel.DEFAULT_VALUES);
          const frame = HeapChoreo.sample(seq, t);
          return frame.items.filter(item => item.mapping === 1).every(item => {
            const a = item.tree, b = item.array;
            const d = `M${a.x},${a.y + 31} C${a.x},${a.y + 75} ${b.x},${b.y - 82} ${b.x},${b.y - 32}`;
            return document.querySelector(`#mapping-lines path[data-id="${item.id}"]`).getAttribute('d') === d;
          });
        }''', event_index + 0.45)
    seek(page, duration)
    seek(page, swap + 0.45)
    assert before == view(page)

    # 真实播放：在正在交换的步内暂停，坐标、颜色与边界全部冻结。
    page.locator('#btn-play').evaluate('(el) => el.click()')
    page.wait_for_timeout(130)
    page.locator('#btn-play').evaluate('(el) => el.click()')
    frozen, frozen_time = view(page), current(page)
    page.wait_for_timeout(350)
    assert frozen == view(page) and frozen_time == current(page)
    page.locator('#speed-slider').evaluate('(el) => {el.value = 2; el.dispatchEvent(new Event("input"));}')
    assert page.locator('#speed-value').inner_text() == '2.0×'
    page.locator('#btn-next').evaluate('(el) => el.click()')
    page.wait_for_function('document.body.dataset.playing === "false"')
    assert float(current(page)).is_integer()
    reached = float(current(page))
    page.locator('#btn-prev').evaluate('(el) => el.click()')
    page.wait_for_function('document.body.dataset.playing === "false"')
    assert float(current(page)) == reached - 1

    # 复位打断在途动作，不存在旧回调再次修改画面。
    page.locator('#btn-play').evaluate('(el) => el.click()')
    page.wait_for_timeout(80)
    page.locator('#btn-reset').evaluate('(el) => el.click()')
    baseline = view(page)
    page.wait_for_timeout(220)
    assert current(page) == '0' and baseline == view(page)

    page.locator('[data-seek="built"]').click()
    assert float(current(page)) == built
    assert page.locator('#action-title').inner_text() == '建堆完成'
    # 两视角用稳定元素身份，焦点映射线与对象下标对应。
    page.locator('.cell[data-id="0"]').focus()
    assert page.locator('#mapping-lines path[data-id="0"]').get_attribute('visibility') == 'visible'
    assert '49' in page.locator('#mapping-label').inner_text()
    page.locator('[data-seek="done"]').click()
    assert sorted_values(page) == [13, 27, 38, 49, 65, 76, 97]
    assert page.locator('#hud-locked').inner_text() == '7'
    assert page.locator('#sort-result').get_attribute('visibility') == 'visible'
    assert page.locator('#result-values').text_content() == '[13, 27, 38, 49, 65, 76, 97]'
    assert page.locator('#btn-next').is_disabled()
    page.screenshot(path='/tmp/heap-complete.png', full_page=True)
    assert page.locator('.node[visibility="visible"]').count() == 0

    seek(page, 6.375)
    page.locator('#mode-min').click()
    assert current(page) == '6.375'
    assert page.locator('#mode-min').get_attribute('aria-pressed') == 'true'
    page.locator('[data-seek="done"]').click()
    assert sorted_values(page) == [97, 76, 65, 49, 38, 27, 13]
    seek(page, 4.375)
    page.locator('#btn-random').click()
    assert current(page) == '4.375'
    assert page.locator('#play-label').inner_text() == '播放'
    saved, snapshot = page.url, view(page)
    page.reload(wait_until='networkidle')
    assert page.url == saved and snapshot == view(page)

    # 键盘在表单外可用，不拦截按钮/输入框的方向与空格。
    page.locator('body').evaluate('(el) => {el.tabIndex=-1;el.focus();}')
    page.keyboard.press('Home')
    assert current(page) == '0'
    page.keyboard.press('ArrowRight')
    page.wait_for_function('document.body.dataset.playing === "false"')
    assert current(page) == '1'
    page.locator('#speed-slider').focus()
    page.keyboard.press('ArrowRight')
    assert current(page) == '1'

    # 后台暂停。
    page.locator('#btn-play').evaluate('(el) => el.click()')
    page.evaluate('''() => {
      Object.defineProperty(document, 'hidden', {configurable: true, value: true});
      document.dispatchEvent(new Event('visibilitychange')); delete document.hidden;
    }''')
    assert page.locator('#play-label').inner_text() == '播放'

    # 减少动态效果按步跳转，切换后不残留旧时间线。
    seek(page, 4.375)
    page.locator('#reduce-motion').check()
    assert current(page) == '5'
    page.locator('#btn-next').click()
    assert current(page) == '6'
    page.locator('#btn-play').click()
    page.wait_for_timeout(580)
    assert float(current(page)).is_integer() and float(current(page)) >= 7
    page.locator('#btn-play').click()
    stopped = current(page)
    page.wait_for_timeout(550)
    assert current(page) == stopped
    page.screenshot(path='/tmp/heap-reduced.png', full_page=True)

    # 窄屏仅舞台内横向滚动。
    page.set_viewport_size({'width': 390, 'height': 844})
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    assert page.locator('.diagram-scroll').evaluate('(el) => el.scrollWidth > el.clientWidth')
    page.screenshot(path='/tmp/heap-narrow.png', full_page=True)
    page.set_viewport_size({'width': 1440, 'height': 1100})

    # 不依赖服务端接口，file://正常加载并可操作。
    local = context.new_page()
    go(local, (ROOT / 'index.html').as_uri())
    local.locator('[data-seek="done"]').click()
    assert sorted_values(local) == [13, 27, 38, 49, 65, 76, 97]

    # 拦截 CDN：真正的无引擎降级，单步、进度和全部排序仍然可用。
    fallback_context = browser.new_context(viewport={'width': 1280, 'height': 1000})
    fallback_context.route('https://**/*', lambda route: route.abort())
    fallback = fallback_context.new_page()
    go(fallback, url)
    assert fallback.locator('#btn-play').is_disabled()
    assert fallback.locator('#engine-notice').is_visible()
    fallback.locator('#btn-next').click()
    assert current(fallback) == '1'
    seek(fallback, 3.45)
    assert current(fallback) == '3.45'
    fallback.locator('[data-seek="done"]').click()
    assert sorted_values(fallback) == [13, 27, 38, 49, 65, 76, 97]
    fallback.screenshot(path='/tmp/heap-no-engine.png', full_page=True)
    fallback.goto((ROOT / 'index.html').as_uri(), wait_until='networkidle')
    fallback.locator('[data-seek="done"]').click()
    assert sorted_values(fallback) == [13, 27, 38, 49, 65, 76, 97]

    # 系统减少动效默认值与非法地址回退。
    reduced_context = browser.new_context(reduced_motion='reduce')
    system = reduced_context.new_page()
    go(system, url + '#a=oops&mode=bad&t=NaN&speed=NaN')
    assert system.locator('#reduce-motion').is_checked()
    assert current(system) == '0'
    assert system.locator('#speed-value').inner_text() == '1.0×'
    assert system.locator('#mode-max').get_attribute('aria-pressed') == 'true'
    assert '49' in system.locator('#data-badge').inner_text()
    assert not errors, errors
    browser.close()
print('PASS：层序建树→调整成堆→堆排序→完整结果、所有交换双映射、HTTP/file、播放暂停、双向单步、快照恢复、减少动效、降级与窄屏检查通过；无页面脚本异常。')
