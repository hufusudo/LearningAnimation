"""Browser acceptance. Start a static server, then pass the module URL if desired.
Artifacts go to /tmp/flux-browser; no browser packages are installed by this script.
"""
from pathlib import Path
import sys
from io import BytesIO
from PIL import Image, ImageChops
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent
URL = sys.argv[1] if len(sys.argv) > 1 else (ROOT / 'index.html').as_uri()
OUT = Path('/tmp/flux-browser')
OUT.mkdir(exist_ok=True)

def check(condition, message):
    if not condition:
        raise AssertionError(message)

def same_picture(first, second):
    # The browser may rasterize the outer 1px border differently after scrollIntoView.
    a,b=Image.open(BytesIO(first)),Image.open(BytesIO(second))
    if a.size!=b.size:
        return False
    box=(2,2,a.width-2,a.height-2)
    return ImageChops.difference(a.crop(box),b.crop(box)).getbbox() is None

def seek(page, time):
    page.locator('#timeSlider').evaluate('(el,t)=>{el.value=t;el.dispatchEvent(new Event("input",{bubbles:true}));}', time)

def step(page, index):
    page.locator(f'button[data-scene="{index}"]').click()

def state(page):
    return page.locator('#stage').evaluate('(el)=>({...el.dataset})')

def focus_body(page):
    page.evaluate('document.activeElement.blur()')

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width':1440,'height':1050}, device_scale_factor=1)
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(URL, wait_until='networkidle')
    check(page.locator('#stage canvas').count() == 1, '3D renderer missing')
    check(page.locator('button[data-scene]').count() == 15, '15 steps missing')
    bounds = page.evaluate('SurfaceFluxChoreo.ENDS')
    total = page.evaluate('SurfaceFluxChoreo.DURATION')
    starts = [0] + bounds[:-1]
    for i in range(15):
        step(page,i)
        check(int(state(page)['scene']) == i, f'step {i} did not seek')
    check(page.locator('#sumValue').inner_text() == '2.370', 'paraboloid sum differs')
    page.locator('#exploreDetails summary').click()
    for model, value in [('plane','2.200'),('paraboloid','2.370'),('hemisphere',None)]:
        before = float(state(page)['time'])
        page.locator('#surfaceSelect').select_option(model)
        check(float(state(page)['time']) == before, 'model change resets time')
        if value:
            check(page.locator('#sumValue').inner_text() == value, f'{model} sum')
    page.locator('#surfaceSelect').select_option('paraboloid')
    # Canonical clock has no history: compare actual canvas after an arbitrary round trip.
    for target in [starts[8], starts[9]+1.15]:
        seek(page,target)
        first = page.locator('#stage canvas').screenshot()
        for t in [total,3.7,starts[5],1.1,target]:
            seek(page,t)
        check(same_picture(page.locator('#stage canvas').screenshot(),first), 'seek round trip changed pixels')
    step(page,8)
    original=page.locator('#stage canvas').screenshot()
    page.locator('[data-view=top]').click()
    page.wait_for_timeout(700)
    check(not same_picture(page.locator('#stage canvas').screenshot(),original), 'top view did not change camera')
    step(page,8)
    restored=page.locator('#stage canvas').screenshot()
    if not same_picture(restored,original):
        (OUT/'view-original.png').write_bytes(original);(OUT/'view-restored.png').write_bytes(restored)
    check(same_picture(restored,original), 'lesson camera did not restore')
    # Count only complete cells; the active cell is not yet counted.
    seek(page,starts[13]+4)
    check(state(page)['accumulated'] == '32', 'half accumulation must contain 32 cells')
    check(page.locator('#sumCount').inner_text() == '32 / 64 块', 'count receipt')
    before = page.locator('#stage canvas').screenshot()
    page.wait_for_timeout(200)
    check(same_picture(page.locator('#stage canvas').screenshot(),before), 'paused canvas moved')
    # Pause in the middle of a geometry/text transition, then resume without a seek.
    seek(page,starts[1]+.6)
    page.locator('#btnPlay').click()
    page.wait_for_function('document.querySelector("#stage").dataset.time > '+str(starts[1]+.8))
    page.locator('#btnPlay').click()
    t = float(state(page)['time'])
    opacity = page.locator('#sceneTitle').evaluate('el=>el.style.opacity')
    canvas = page.locator('#stage canvas').screenshot()
    page.wait_for_timeout(200)
    check(float(state(page)['time']) == t, 'pause changed clock')
    check(page.locator('#sceneTitle').evaluate('el=>el.style.opacity') == opacity, 'pause altered text')
    check(same_picture(page.locator('#stage canvas').screenshot(),canvas), 'pause altered geometry')
    page.locator('#speedSelect').select_option('2')
    check(float(state(page)['time']) == t, 'speed control resets time')
    page.locator('#btnPlay').click()
    page.wait_for_function('document.querySelector("#stage").dataset.time > '+str(t+.15))
    page.locator('#btnPlay').click()
    check(float(state(page)['time']) > t, 'resume did not continue')
    page.locator('#speedSelect').select_option('1')
    # Angle/orientation experiment, formula and finite patch values.
    step(page,0)
    page.locator('#angleSlider').fill('90')
    check(page.locator('#quantityActual').inner_text() == 'Φ = +0.000', 'edge-on net not zero')
    page.locator('#angleSlider').fill('0')
    page.locator('#reducedMotion').check()
    page.locator('#btnFlip').click()
    check(page.locator('#quantityActual').inner_text() == 'Φ = -2.352', 'orientation did not reverse flux')
    step(page,8)
    page.locator('#mathDetails summary').click()
    page.locator('#formula .katex').wait_for()
    check(page.locator('[data-component="r"]').inner_text().endswith('+0.300'), 'projected contribution')
    # Reduced motion keeps the same step geometry at any internal time.
    canvas = page.locator('#stage canvas').screenshot(mask=[page.locator('#stageTime')])
    seek(page,starts[8]+1)
    after = page.locator('#stage canvas').screenshot(mask=[page.locator('#stageTime')])
    if not same_picture(after,canvas):
        (OUT/'reduced-a.png').write_bytes(canvas);(OUT/'reduced-b.png').write_bytes(after)
        print('Reduced debug',state(page),page.locator('#reducedMotion').is_checked(),flush=True)
    check(same_picture(after,canvas), 'reduced motion interpolates')
    page.locator('#btnPlay').click()
    page.wait_for_function('document.querySelector("#stage").dataset.scene === "9"')
    page.locator('#btnPlay').click()
    page.locator('#reducedMotion').uncheck()
    focus_body(page)
    page.keyboard.press('Home')
    check(state(page)['scene'] == '0', 'Home')
    page.keyboard.press('ArrowRight')
    check(state(page)['scene'] == '1', 'right key')
    page.keyboard.press('ArrowLeft')
    check(state(page)['scene'] == '0', 'left key')
    page.keyboard.press('Space')
    check(state(page)['playing'] == 'true', 'space play')
    page.keyboard.press('Space')
    check(state(page)['playing'] == 'false', 'space pause')
    # Controls keep ownership of arrow keys.
    page.locator('#angleSlider').focus()
    page.keyboard.press('ArrowRight')
    check(state(page)['scene'] == '0', 'form arrow key was intercepted')
    for i in [0,4,6,8,9,10,11,14]:
        step(page,i)
        page.wait_for_timeout(220)
        page.screenshot(path=str(OUT/f'desktop-{i:02d}.png'),full_page=True)
    page.set_viewport_size({'width':390,'height':900})
    for i in [0,6,8,11,14]:
        step(page,i)
        check(page.evaluate('document.documentElement.scrollWidth <= innerWidth'), f'page overflow at {i}')
        page.screenshot(path=str(OUT/f'narrow-{i:02d}.png'),full_page=True)
    check(not errors, 'page errors: '+repr(errors))
    page.close()
    # System reduced-motion preference must be respected at page load.
    reduced=browser.new_page(reduced_motion='reduce')
    reduced.goto(URL,wait_until='networkidle')
    check(reduced.locator('#reducedMotion').is_checked(), 'system motion preference ignored')
    reduced.close()
    # Independently simulate each missing external resource.
    for missing in ['gsap','three','katex','all']:
        page = browser.new_page(viewport={'width':1280,'height':960})
        failed = []
        page.on('pageerror', lambda e: failed.append(str(e)))
        def route_request(route, request):
            kind=missing
            url=request.url
            block=kind=='all' and url.startswith('https:') or kind in url
            route.abort() if block else route.continue_()
        page.route('**/*',route_request)
        page.goto(URL,wait_until='networkidle')
        for i in [0,4,8,11,14]:
            step(page,i)
            check(state(page)['scene'] == str(i), f'{missing}: step failed')
        check(page.locator('#sumValue').inner_text() == '2.370', f'{missing}: sum')
        if missing in ['three','all']:
            check(page.locator('#staticStage').is_visible(), 'SVG fallback absent')
            check(page.locator('#staticDrawing polygon').count() > 0, 'fallback geometry absent')
        if missing in ['gsap','all']:
            check(page.locator('#btnPlay').is_disabled(), 'missing GSAP allowed playback')
            seek(page,starts[13]+4)
            check(state(page)['accumulated'] == '32', 'missing engine broke seek')
        if missing in ['katex','all']:
            page.locator('#mathDetails summary').click()
            check('\\' not in page.locator('#formula').inner_text(), 'raw LaTeX fallback')
        check(not failed, f'{missing} page errors: {failed}')
        page.screenshot(path=str(OUT/f'fallback-{missing}.png'),full_page=True)
        page.close()
    browser.close()
    print('PASS: all steps, pixel-stable seeking, pause/resume, speed, orientation, model sums, keyboard, reduced motion, desktop/narrow and four dependency failures')
