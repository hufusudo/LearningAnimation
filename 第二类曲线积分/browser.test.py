"""Run against a static server at repository root; no browser installation needed here."""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = os.environ.get('LINE_INTEGRAL_BASE_URL', 'http://127.0.0.1:8013/第二类曲线积分/')
ARTIFACTS = Path('/tmp/second-line-integral')
ARTIFACTS.mkdir(exist_ok=True)


def frame(page):
    return page.locator('#work-svg').evaluate('(svg) => ({t:+svg.dataset.time,step:+svg.dataset.step,work:+svg.dataset.work})')


def scrub(page, fraction):
    page.locator('#progress-input').evaluate('(el,v)=>{el.value=v;el.dispatchEvent(new Event("input",{bubbles:true}));}', round(fraction*10000))


def near(a, b, tolerance=1e-5):
    assert abs(a-b)<tolerance, (a,b)


def run():
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True)
        page=browser.new_page(viewport={'width':1440,'height':1100})
        errors=[]
        page.on('pageerror', lambda err: errors.append(str(err)))
        page.goto(BASE,wait_until='networkidle')
        assert page.evaluate('!!window.gsap'), 'CDN unavailable; normal playback must be tested with the real engine'
        assert not page.locator('#play-button').is_disabled()
        near(frame(page)['t'],0)
        page.locator('#next-button').click()
        near(frame(page)['t'],1.3)
        page.locator('#next-button').click()
        near(frame(page)['t'],2.35)
        page.locator('#prev-button').click()
        near(frame(page)['t'],1.3)
        page.locator('#reset-button').click()
        # One segment: separate projections, sum, chip flight, then ledger change.
        page.locator('[data-phase="3"]').click()
        near(frame(page)['work'],0)
        page.screenshot(path=str(ARTIFACTS/'desktop.png'),full_page=True)
        page.locator('#next-button').click()
        assert frame(page)['work']>0
        assert '1 / 12' in page.locator('#completion').inner_text()
        # Seeking depends only on the target, including the SVG geometry.
        scrub(page,.3731)
        expected=page.locator('#dynamic-scene').inner_html()
        scrub(page,.86);scrub(page,.01);scrub(page,.3731)
        assert page.locator('#dynamic-scene').inner_html()==expected
        # Final work, reversed paired geometry and convergence to analytic parabola work.
        scrub(page,1)
        work=frame(page)['work']
        expected_work=page.evaluate('LineIntegralModel.buildPartition("parabola","vortex",12).total.work')
        near(work,expected_work)
        page.locator('#reverse-button').click()
        near(frame(page)['work'],-work)
        assert page.locator('#reverse-button').get_attribute('aria-pressed')=='true'
        page.locator('#reverse-button').click()
        page.locator('#partition-select').select_option('24')
        scrub(page,1)
        refined=frame(page)['work']
        assert abs(refined-76/15)<abs(work-76/15)
        # All 18 path/field/direction configurations reach their model totals.
        page.locator('#partition-select').select_option('12')
        for path in ['polyline','parabola','semicircle']:
            page.locator('#path-select').select_option(path)
            for field in ['vortex','radial','constant']:
                page.locator('#field-select').select_option(field)
                for reverse in [False,True]:
                    pressed=page.locator('#reverse-button').get_attribute('aria-pressed')=='true'
                    if pressed!=reverse:page.locator('#reverse-button').click()
                    scrub(page,1)
                    actual=frame(page)['work']
                    target=page.evaluate('(p)=>LineIntegralModel.buildPartition(p.path,p.field,12,p.reverse).total.work',{'path':path,'field':field,'reverse':reverse})
                    near(actual,target)
        page.locator('#path-select').select_option('semicircle')
        page.locator('#field-select').select_option('radial')
        scrub(page,1)
        near(frame(page)['work'],0)
        # Real playback, speed setting, pause and resume.
        page.locator('#path-select').select_option('polyline')
        page.locator('#field-select').select_option('vortex')
        page.locator('#reset-button').click()
        page.locator('#play-button').click()
        page.wait_for_function('Number(document.querySelector("#work-svg").dataset.time)>.15')
        page.locator('#play-button').click()
        frozen=frame(page)['t']
        page.wait_for_timeout(180)
        near(frame(page)['t'],frozen)
        page.locator('#speed-select').select_option('2')
        assert page.evaluate('gsap.globalTimeline.getChildren(false,false,true).some(t=>t.timeScale()===2)')
        page.locator('#play-button').click()
        page.wait_for_function('(t)=>Number(document.querySelector("#work-svg").dataset.time)>t+.15',arg=frozen)
        page.locator('#play-button').click()
        # Keyboard shortcuts and form focus protection.
        page.locator('#reset-button').click()
        page.locator('body').click(position={'x':5,'y':5})
        page.keyboard.press('ArrowRight');near(frame(page)['t'],1.3)
        page.keyboard.press('ArrowLeft');near(frame(page)['t'],0)
        page.keyboard.press('Space')
        page.wait_for_function('Number(document.querySelector("#work-svg").dataset.time)>.05')
        page.keyboard.press('Space')
        frozen=frame(page)['t'];page.wait_for_timeout(100);near(frame(page)['t'],frozen)
        page.keyboard.press('Home');near(frame(page)['t'],0)
        page.locator('#path-select').focus()
        prevented=page.locator('#path-select').evaluate('(el)=>{const e=new KeyboardEvent("keydown",{code:"ArrowRight",bubbles:true,cancelable:true});el.dispatchEvent(e);return e.defaultPrevented;}')
        assert not prevented
        near(frame(page)['t'],0)
        # Reduced motion: exact event ends, including during autoplay.
        page.locator('#reduced-motion').check()
        page.locator('#next-button').click();near(frame(page)['t'],1.3)
        assert page.locator('[data-phase="0"]').get_attribute('aria-current')=='step'
        assert '取一小段' in page.locator('#progress-input').get_attribute('aria-valuetext')
        page.locator('#play-button').click()
        page.wait_for_function('Number(document.querySelector("#work-svg").dataset.time)>1.3')
        page.locator('#play-button').click()
        reduced_time=frame(page)['t']
        assert page.evaluate('(t)=>Array.from({length:61},(_,i)=>LineIntegralChoreo.boundary(i)).some(v=>Math.abs(v-t)<1e-5)',reduced_time)
        page.locator('[data-focus="y"]').click()
        assert page.locator('[data-focus="y"]').get_attribute('aria-pressed')=='true'
        # No page-level overflow; the diagram has a local scroll container.
        page.set_viewport_size({'width':390,'height':844})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        assert page.locator('.stage-scroll').evaluate('(el)=>el.scrollWidth>el.clientWidth')
        page.screenshot(path=str(ARTIFACTS/'narrow.png'),full_page=True)
        assert not errors,errors
        page.close()
        # Missing animation engine: real local UI still works without a stub.
        fallback=browser.new_page(viewport={'width':1280,'height':900})
        fallback.on('pageerror', lambda err: errors.append(str(err)))
        fallback.route('**/gsap.min.js',lambda route:route.abort())
        fallback.goto(BASE,wait_until='networkidle')
        assert fallback.locator('#play-button').is_disabled()
        assert fallback.locator('#engine-notice').is_visible()
        fallback.locator('#next-button').click();near(frame(fallback)['t'],1.3)
        scrub(fallback,1)
        assert frame(fallback)['work']>0
        fallback.locator('#reverse-button').click()
        assert frame(fallback)['work']<0
        assert not errors,errors
        fallback.close()
        # file:// uses local scripts; engine is intentionally unavailable here too.
        local=browser.new_page(reduced_motion='reduce')
        local.route('**/gsap.min.js',lambda route:route.abort())
        local.goto((Path(__file__).resolve().parent/'index.html').as_uri(),wait_until='networkidle')
        assert local.locator('#reduced-motion').is_checked()
        assert local.locator('#play-button').is_disabled()
        local.locator('#next-button').click();near(frame(local)['t'],1.3)
        scrub(local,1)
        assert frame(local)['work']>0
        local.close()
        browser.close()
        print('PASS: 18 configurations, signed work, convergence, deterministic seeking, transport, speed, keyboard, reduced motion, narrow layout, engine fallback and file://')

if __name__=='__main__':
    run()
