<template>
	<div	id=app   class = "wrapper"
		data-x=''   >
    <img src=/logo.png alt="Logo">
    <input type=text disabled   value="a=b" >
    <br>
    <MyButton label="Click
me" title="" TITLE="upper" />
    <pre>  keep   this   <b  x="1">bold</b>
    exactly</pre>
    <textarea placeholder="p">  raw {{ not }} text </textarea>
    <svg viewBox="0 0 10 10"><path d="M0 0L10 10" stroke-width="2"/></svg>
    <!-- a comment with <tags attr="x"> inside -->
    <p>ünïcödé 🎉 <span lang="ja">日本語</span></p>
    <MyButton
        v-for="i in 3"   :key="i"
        label="repeated"   @click.stop="go(i)"
    ></MyButton>
    <template v-if="ok"><Foo a="1"/></template>
    <template v-else>
      <Bar b="2" />
    </template>
  </div>
  <footer class="second-root" />
</template>

<script setup lang="ts">
import MyButton from './MyButton.vue'
import Foo from './Foo.vue'
import Bar from './Bar.vue'
const ok = true
function go(n: number) { return n }
</script>

<style lang="scss" scoped>
.wrapper { .inner { color: red } }
</style>
