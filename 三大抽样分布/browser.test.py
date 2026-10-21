"""Browser acceptance: serve the repository on :8128, or pass a base URL."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import json
import math
import sys

MODULE=Path(__file__).resolve().parent
BASE=sys.argv[1] if len(sys.argv)>1 else 'http://127.0.0.1:8128/'
URL=BASE.rstrip('/')+'/'+MODULE.name+'/index.html'
ARTIFACTS=Path('/tmp/sampling-qa')
ARTIFACTS.mkdir(exist_ok=True)


def slider(page,selector,value):
    page.locator(selector).evaluate('(el,v)=>{el.value=v;el.dispatchEvent(new Event("input",{bubbles:true}))}',value)


def state(page):
    return page.evaluate('''()=>({
      t:Number(document.querySelector('#progress').value),
      point:Number(document.querySelector('#point-value').textContent),
      left:Number(document.querySelector('#left-probability').textContent),
      right:Number(document.querySelector('#right-probability').textContent),
      leftOpacity:Number(document.querySelector('#left-area').style.opacity),
      rightOpacity:Number(document.querySelector('#right-area').style.opacity),
      leftPath:document.querySelector('#left-area').getAttribute('d'),
      rightPath:document.querySelector('#right-area').getAttribute('d'),
      equation:document.querySelector('#equation').textContent,
      curve:document.querySelector('#density-curve').getAttribute('d'),
      hash:location.hash
    })''')


def snapshot(page,name):
    page.wait_for_timeout(220)
    page.screenshot(path=str(ARTIFACTS/name),full_page=True)


with sync_playwright() as p:
    browser=p.chromium.launch(headless=True)
    page=browser.new_page(viewport={'width':1440,'height':1100})
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(URL,wait_until='networkidle')
    assert page.locator('#engine-notice').is_hidden()
    assert state(page)['point']==15.5073
    stops=[1.8,4.3,6.8,9.8,12.3,15]
    upper=None
    for index,t in enumerate(stops):
        page.locator('[data-time="'+str(t if t!=15 else 15)+'"]').click()
        f=state(page)
        assert f['t']==t
        assert abs(f['left']+f['right']-1)<1e-8
        if index<3:
            upper=f['point'] if upper is None else upper
            assert f['point']==upper, 'same-point complement must not move the boundary'
        if index in [1,4]:
            assert f['rightOpacity']>.6 and f['leftOpacity']==0, (index,f)
        if index in [2,3,5]:
            assert f['leftOpacity']>.6 and f['rightOpacity']==0, (index,f)
        if index==1:assert f['right']==.05
        if index==2:assert f['left']==.95
        if index>=3:assert f['point']<upper and f['left']==.05
    assert '1 − P' in state(page)['equation']
    page.locator('[data-time="4.3"]').click()
    snapshot(page,'chi-right-tail.png')
    page.locator('[data-time="6.8"]').click()
    snapshot(page,'chi-same-point-complement.png')
    page.locator('[data-time="15"]').click()
    snapshot(page,'chi-left-tail.png')

    # Time seeking redraws exactly; moving the cut changes both probabilities.
    slider(page,'#progress',8.4)
    moving=state(page)
    assert .05<moving['right']<.95
    slider(page,'#progress',2.7)
    slider(page,'#progress',8.4)
    again=state(page)
    for key in ['point','left','right','leftPath','rightPath']:
        assert moving[key]==again[key],key

    # Distribution and parameter changes preserve time and distinct df values.
    slider(page,'#single-df',12)
    page.locator('[data-distribution=t]').click()
    assert state(page)['t']==8.4
    assert page.locator('#single-df').input_value()=='8'
    slider(page,'#single-df',1)
    page.locator('#alpha-level').select_option('0.01')
    slider(page,'#progress',4.3)
    assert abs(state(page)['point']-31.8205)<.0001
    assert page.locator('#tail-window').is_visible()
    page.locator('[data-time="15"]').click()
    assert abs(state(page)['point']+31.8205)<.0001
    snapshot(page,'t-cauchy-left.png')
    page.locator('[data-distribution=chi]').click()
    assert page.locator('#single-df').input_value()=='12'
    page.locator('[data-distribution=t]').click()
    assert page.locator('#single-df').input_value()=='1'

    # F(2,1) extreme right point and tiny left boundary both remain readable.
    page.locator('[data-distribution=f]').click()
    slider(page,'#f-df1',2);slider(page,'#f-df2',1)
    page.locator('[data-time="4.3"]').click()
    assert abs(state(page)['point']-4999.5)<.001
    assert page.locator('#tail-window').is_visible()
    assert page.locator('#quantile-line').evaluate('el=>Number(el.style.opacity)')==0
    assert '图外概率' in page.locator('#window-note').text_content()
    assert '独立' in page.locator('#footnote').inner_text()
    snapshot(page,'f-heavy-right.png')
    page.locator('[data-time="15"]').click()
    assert abs(state(page)['point']-.0102)<.0001
    assert state(page)['left']==.01
    snapshot(page,'f-heavy-left.png')
    assert not any(value in page.locator('#distribution-plot').inner_html() for value in ['NaN','Infinity'])
    for key,val in [('#f-df1',20),('#f-df2',30)]:slider(page,key,val)
    assert math.isfinite(state(page)['point'])
    assert state(page)['t']==15

    # Real clock: pause freezes; speed and reduced motion can change during playback.
    page.locator('#reset').click()
    page.locator('#play').click();page.wait_for_timeout(320);page.locator('#play').click()
    frozen=state(page)['t'];assert frozen>.1
    page.wait_for_timeout(150);assert state(page)['t']==frozen
    page.locator('#speed').select_option('2')
    page.locator('#play').click();page.wait_for_timeout(300);page.locator('#play').click()
    assert state(page)['t']>frozen+.4
    page.locator('#play').click();page.locator('#reduced-motion').check()
    assert page.locator('#play').inner_text()=='暂停演示'
    page.wait_for_timeout(600)
    assert state(page)['t']>=2
    page.locator('#play').click();page.locator('#reduced-motion').uncheck()

    # Named stops, keyboard navigation, and saved URL state.
    slider(page,'#progress',6.8);page.locator('#previous').click()
    assert state(page)['t']==4.3
    page.locator('#next').click();assert state(page)['t']==6.8
    page.locator('h1').click();page.keyboard.press('Home');assert state(page)['t']==0
    page.keyboard.press('ArrowRight');assert state(page)['t']==1.8
    slider(page,'#progress',13.8)
    expected=state(page)
    page.reload(wait_until='networkidle')
    actual=state(page)
    for key in ['t','point','left','right','leftPath','rightPath','equation']:
        assert expected[key]==actual[key],('hash',key)
    for width in [1280,820,390]:
        page.set_viewport_size({'width':width,'height':1000});page.wait_for_timeout(80)
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'),width
    assert page.locator('#left-probability-mobile').is_visible()
    assert page.locator('#left-probability-mobile').inner_text()==page.locator('#left-probability').text_content()
    assert page.locator('.chart-scroll').evaluate('el=>el.scrollWidth > el.clientWidth')
    snapshot(page,'narrow.png')

    # file:// normal playback and missing-engine manual stage browsing.
    local=browser.new_page(viewport={'width':1280,'height':1000})
    local.on('pageerror',lambda e:errors.append(str(e)))
    local.goto(MODULE.joinpath('index.html').as_uri(),wait_until='networkidle')
    assert not local.locator('#play').is_disabled()
    local.locator('#play').click();local.wait_for_timeout(150);local.locator('#play').click()
    assert state(local)['t']>0
    local.close()
    offline=browser.new_page(viewport={'width':1280,'height':1000})
    offline.on('pageerror',lambda e:errors.append(str(e)))
    offline.route('https://**/*',lambda route:route.abort())
    offline.goto(MODULE.joinpath('index.html').as_uri(),wait_until='networkidle')
    assert offline.locator('#play').is_disabled()
    assert offline.locator('#engine-notice').is_visible()
    offline.locator('[data-time="4.3"]').click()
    assert state(offline)['rightOpacity']>.6
    offline.locator('[data-time="6.8"]').click()
    assert state(offline)['leftOpacity']>.6 and state(offline)['rightOpacity']==0
    offline.locator('[data-time="12.3"]').click()
    assert state(offline)['rightOpacity']>.6
    offline.locator('[data-time="15"]').click()
    assert state(offline)['leftOpacity']>.6
    snapshot(offline,'file-no-engine.png')
    offline.locator('#reduced-motion').check()
    slider(offline,'#progress',2)
    assert state(offline)['rightOpacity']>.6
    slider(offline,'#progress',4.5)
    assert state(offline)['leftOpacity']>.6
    assert not errors,errors
    print(json.dumps({'status':'PASS','checks':['six-stage-completion','same-point-complement','moving-quantile','reverse-redraw','parameters-preserve-time','distinct-df','t1-heavy-tail','f2-1-heavy-tail','extreme-df','pause-speed','reduced-motion','keyboard','url-restore','narrow-layout','file','no-engine'],'page_errors':errors,'screenshots':str(ARTIFACTS)},ensure_ascii=False))
    browser.close()
