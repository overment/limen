#!/usr/bin/env ruby
# frozen_string_literal: true

# Minimal Darwin proc_pidinfo(PROC_PIDTBSDINFO) boundary. The offsets are the
# public proc_bsdinfo ABI from sys/proc_info.h on 64-bit macOS.
require "fiddle"
require "json"

pid_text = ARGV.fetch(0, "")
exit 64 unless ARGV.length == 1 && /\A[1-9]\d*\z/.match?(pid_text)
pid = Integer(pid_text, 10)

PROC_PIDTBSDINFO = 3
PBI_COMM = 48
PBI_PPID = 16
PBI_PGID = 100
PBI_START_TVSEC = 120
PBI_START_TVUSEC = 128
PROC_BSDINFO_SIZE = 136

kernel = Fiddle.dlopen("/usr/lib/system/libsystem_kernel.dylib")
proc_pidinfo = Fiddle::Function.new(
  kernel["proc_pidinfo"],
  [Fiddle::TYPE_INT, Fiddle::TYPE_INT, Fiddle::TYPE_LONG_LONG, Fiddle::TYPE_VOIDP, Fiddle::TYPE_INT],
  Fiddle::TYPE_INT,
)
buffer = "\0".b * PROC_BSDINFO_SIZE
size = proc_pidinfo.call(pid, PROC_PIDTBSDINFO, 0, buffer, buffer.bytesize)
if size < PROC_BSDINFO_SIZE
  absent = size.zero? && Fiddle.last_error == Errno::ESRCH::Errno
  puts JSON.generate({ status: "absent" }) if absent
  exit(absent ? 0 : 1)
end

actual_pid = buffer.byteslice(12, 4).unpack1("L<")
exit 1 unless actual_pid == pid
command = buffer.byteslice(PBI_COMM, 16).split("\0", 2).first
seconds = buffer.byteslice(PBI_START_TVSEC, 8).unpack1("Q<")
microseconds = buffer.byteslice(PBI_START_TVUSEC, 8).unpack1("Q<")
puts JSON.generate({ pid: actual_pid, ppid: buffer.byteslice(PBI_PPID, 4).unpack1("L<"), pgid: buffer.byteslice(PBI_PGID, 4).unpack1("L<"), born: format("%d.%06d", seconds, microseconds), command: command })
