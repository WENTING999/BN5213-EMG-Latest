"""Compile three UNO variants using the installed Arduino AVR core. Never uploads."""
from pathlib import Path
import argparse
import subprocess

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--packages', type=Path, default=Path.home() / 'AppData/Local/Arduino15/packages/arduino')
args = parser.parse_args()
base = args.packages / 'hardware/avr/1.8.8'
core, variant = base / 'cores/arduino', base / 'variants/standard'
bin_dir = args.packages / 'tools/avr-gcc/7.3.0-atmel3.6.1-arduino7/bin'
build = ROOT / 'build'
build.mkdir(exist_ok=True)
common = ['-g', '-Os', '-mmcu=atmega328p', '-DF_CPU=16000000L', '-DARDUINO=10819', '-DARDUINO_AVR_UNO', '-DARDUINO_ARCH_AVR', '-ffunction-sections', '-fdata-sections', '-flto', '-I'+str(core), '-I'+str(variant)]
cpp = ['-std=gnu++11', '-fpermissive', '-fno-exceptions', '-fno-threadsafe-statics', '-Wno-error=narrowing']

def run(tool, arguments):
    result = subprocess.run([str(bin_dir / (tool+'.exe')), *map(str,arguments)], text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stdout+result.stderr)
    return result.stdout

objects=[]
for source in sorted(core.iterdir()):
    if source.suffix not in ('.c','.cpp','.S'):
        continue
    obj=build/(source.name+'.o')
    flags=cpp if source.suffix=='.cpp' else ['-std=gnu11','-fno-fat-lto-objects'] if source.suffix=='.c' else ['-x','assembler-with-cpp']
    run('avr-g++' if source.suffix=='.cpp' else 'avr-gcc',['-c',*common,*flags,source,'-o',obj]);objects.append(obj)
archive=build/'core.a'
run('avr-gcc-ar',['rcs',archive,*objects])
report=['Target: Arduino UNO R3 / ATmega328P / 16 MHz','AVR core 1.8.8; avr-gcc 7.3.0-atmel3.6.1-arduino7','Compile + link + Intel HEX only. No hardware upload or acquisition.','']
for name, defines in [('REAL_A0',[]),('SIM_A0',['-DBN_EMG_SIMULATION=1']),('REAL_A0_A1',['-DBN_EMG_CHANNELS=2'])]:
    obj=build/(name+'.o');elf=build/(name+'.elf')
    run('avr-g++',['-c',*common,*cpp,'-Wall','-Wextra',*defines,'-x','c++',ROOT/'firmware/BN5213_EMG/BN5213_EMG.ino','-o',obj])
    run('avr-gcc',['-Os','-g','-flto','-fuse-linker-plugin','-mmcu=atmega328p','-Wl,--gc-sections','-o',elf,obj,archive,'-L'+str(build),'-lm'])
    run('avr-objcopy',['-O','ihex','-R','.eeprom',elf,build/(name+'.hex')])
    report += [name+': PASS',run('avr-size',['-C','--mcu=atmega328p',elf]).strip(),'']
(ROOT/'validation/BUILD_REPORT.txt').write_text('\n'.join(report),encoding='utf-8')
print('\n'.join(report))
