#!/bin/bash

errPath=$(mktemp)
echo $errPath

while IFS='$\n' read -r cmd
do
  # cleanup eventual error output
  rm $errPath
  eval "$cmd" 2>$errPath
  # By printing the status code to stderr, we can establish that th
  # code has finished running
  exit=$?
  # echo "${cmd} ... ${exit}" >&2
  (printf "%x" $exit) >&2
done < /dev/stdin

